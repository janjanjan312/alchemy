import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const KNOWLEDGE_DIR = path.resolve(__dirname, '../knowledge');
const DB_PATH = path.resolve(__dirname, '../psyche.db');

const DASHSCOPE_EMBED_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
const EMBED_MODEL = process.env.DASHSCOPE_EMBED_MODEL || 'text-embedding-v3';
const EMBED_DIMENSIONS = 1024;
const BATCH_SIZE = 10;
const CHUNK_SIZE_ZH = 400;
const CHUNK_OVERLAP_ZH = 80;
const CHUNK_SIZE_EN = 800;
const CHUNK_OVERLAP_EN = 150;

const MAX_EMBED_INPUT_LEN = 8000;

async function embedBatch(texts: string[], retries = 2): Promise<Float32Array[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set in .env');

  const safeTexts = texts.map(t => t.length > MAX_EMBED_INPUT_LEN ? t.slice(0, MAX_EMBED_INPUT_LEN) : t);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(DASHSCOPE_EMBED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: safeTexts, dimensions: EMBED_DIMENSIONS }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${err}`);
      }

      const data = await res.json();
      return data.data.map((item: { embedding: number[] }) => new Float32Array(item.embedding));
    } catch (err: any) {
      console.error(`    Attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('All embedding attempts failed');
}

function extractTitle(text: string, filename: string): string {
  const firstLine = text.split('\n').find(l => l.trim());
  if (firstLine) {
    const cleaned = firstLine.replace(/^#+\s*/, '').trim();
    if (cleaned.length > 0 && cleaned.length < 100) return cleaned;
  }
  return path.basename(filename, path.extname(filename));
}

function chunkText(text: string, sourceFile: string, lang: 'zh' | 'en' = 'zh'): { title: string; content: string; index: number }[] {
  const CHUNK_SIZE = lang === 'en' ? CHUNK_SIZE_EN : CHUNK_SIZE_ZH;
  const CHUNK_OVERLAP = lang === 'en' ? CHUNK_OVERLAP_EN : CHUNK_OVERLAP_ZH;

  const lines = text.split('\n');
  const chunks: { title: string; content: string; index: number }[] = [];

  let currentSection = extractTitle(text, sourceFile);
  let buffer = '';
  let chunkIndex = 0;

  const headingRe = lang === 'en'
    ? /^(?:#{1,3}\s+(.+)|([A-Z][A-Z\s]{5,})$)/
    : /^#{1,3}\s+(.+)/;

  for (const line of lines) {
    const headingMatch = line.match(headingRe);
    if (headingMatch) {
      const heading = (headingMatch[1] || headingMatch[2] || '').trim();
      if (heading && buffer.trim().length > 50) {
        chunks.push({ title: currentSection, content: buffer.trim(), index: chunkIndex++ });
        buffer = buffer.slice(-CHUNK_OVERLAP);
      }
      if (heading) currentSection = heading;
    }

    buffer += line + '\n';

    if (buffer.length >= CHUNK_SIZE) {
      // For English, try to break at sentence boundary
      if (lang === 'en') {
        const sentEnd = buffer.lastIndexOf('. ', CHUNK_SIZE);
        if (sentEnd > CHUNK_SIZE * 0.6) {
          const chunk = buffer.slice(0, sentEnd + 1).trim();
          chunks.push({ title: currentSection, content: chunk, index: chunkIndex++ });
          buffer = buffer.slice(sentEnd + 1 - CHUNK_OVERLAP);
          continue;
        }
      }
      chunks.push({ title: currentSection, content: buffer.trim(), index: chunkIndex++ });
      buffer = buffer.slice(-CHUNK_OVERLAP);
    }
  }

  if (buffer.trim().length > 30) {
    chunks.push({ title: currentSection, content: buffer.trim(), index: chunkIndex });
  }

  return chunks;
}

const SKIP_FRONT_PAGES = 14;

async function parsePdf(filePath: string): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  console.log(`  PDF pages: ${doc.numPages}, skipping first ${SKIP_FRONT_PAGES} (front matter)`);
  const pages: string[] = [];

  for (let i = SKIP_FRONT_PAGES + 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      const lineFragments: string[] = [];
      for (const item of content.items as any[]) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 5) {
          lineFragments.push('\n');
        }
        lineFragments.push(item.str);
        if (y !== undefined) lastY = y;
      }
      const text = lineFragments.join(' ').replace(/ *\n */g, '\n');
      if (text.trim()) pages.push(text);
    } catch {
      // skip unreadable pages
    }
  }

  doc.destroy();
  return pages.join('\n');
}

function cleanEnglishText(text: string): string {
  let t = text;

  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  t = t.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');

  // Fix letter-spaced words from PDF typesetting: "T R A N S L A T E D" → "TRANSLATED"
  t = t.replace(/\b([A-Z])((?:\s[A-Z]){3,})\b/g, (_match, first, rest) => {
    return first + rest.replace(/\s/g, '');
  });

  // Remove running page headers (book title / section titles repeated on every page)
  t = t.replace(/^\s*(?:THE\s+)?ARCHETYPES\s+(?:(?:OF|AND)\s+)?THE\s+COLLECTIVE\s+UNCONSCIOUS\s*$/gim, '');
  t = t.replace(/^\s*CONCERNING\s+(?:THE\s+)?ARCHETYPES.*$/gim, '');
  t = t.replace(/^\s*THE\s+CONCEPT\s+OF\s+THE\s+COLLECTIVE\s+UNCONSCIOUS\s*$/gim, '');
  t = t.replace(/^\s*ARCHETYPES\s+OF\s+THE\s+COLLECTIVE\s+UNCONSCIOUS\s*$/gim, '');
  t = t.replace(/^\s*CONSCIOUS,?\s+UNCONSCIOUS,?\s+AND\s+INDIVIDUATION\s*$/gim, '');
  t = t.replace(/^\s*(?:THE\s+)?PSYCHOLOGICAL\s+ASPECTS\s+OF\s+THE\s+(?:KORE|MOTHER)\s+ARCHETYPE\s*$/gim, '');
  t = t.replace(/^\s*A\s+STUDY\s+IN\s+THE\s+PROCESS\s+OF\s+INDIVIDUATION\s*$/gim, '');
  t = t.replace(/^\s*CONCERNING\s+MANDALA\s+SYMBOLISM\s*$/gim, '');
  t = t.replace(/^\s*CONCERNING\s+REBIRTH\s*$/gim, '');

  // Remove standalone page numbers
  t = t.replace(/^\s*\d{1,4}\s*$/gm, '');

  // Remove footnote superscript numbers at end of sentences
  t = t.replace(/\s+\d{1,3}\s*$/gm, '');

  // Remove copyright / publishing lines
  t = t.replace(/^\s*(COPYRIGHT|ISBN|MANUFACTURED|LIBRARY OF CONGRESS|BOLLINGEN|PRINTED|PRINCETON UNIVERSITY PRESS).*$/gim, '');

  // Collapse hyphenated line breaks: "con-\ncept" → "concept"
  t = t.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  // Fix hyphenated words split across lines that became "word- word" after joining
  t = t.replace(/([a-z])-\s{2,}([a-z])/g, '$1$2');

  // Collapse excessive whitespace on each line
  t = t.split('\n').map(line => line.replace(/\s{3,}/g, ' ').trim()).join('\n');

  // Remove very short lines (< 15 chars) that are likely headers/artifacts, unless they end a sentence
  t = t.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (trimmed.length < 10 && !/[.!?:;]$/.test(trimmed)) return false;
    return true;
  }).join('\n');

  // Collapse multiple blank lines
  t = t.replace(/\n{3,}/g, '\n\n');

  // Join short consecutive lines into paragraphs (PDF extracts lines per visual row)
  const lines = t.split('\n');
  const merged: string[] = [];
  let buf = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buf) { merged.push(buf); buf = ''; }
      merged.push('');
      continue;
    }
    if (buf && !buf.endsWith('.') && !buf.endsWith(':') && !buf.endsWith(';') && !buf.endsWith('?') && !buf.endsWith('!')) {
      buf += ' ' + trimmed;
    } else if (buf) {
      merged.push(buf);
      buf = trimmed;
    } else {
      buf = trimmed;
    }
  }
  if (buf) merged.push(buf);

  return merged.join('\n').trim();
}

function isEnglishNoiseChunk(content: string): boolean {
  const stripped = content.replace(/\s+/g, '');
  if (stripped.length < 40) return true;

  const letterCount = (stripped.match(/[a-zA-Z]/g) || []).length;
  if (letterCount / stripped.length < 0.5) return true;

  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length > 0 && lines.every(l => l.trim().length < 15)) return true;

  // Bibliography / reference list chunks
  const bibLines = lines.filter(l => {
    const t = l.trim();
    return /\b\d{4}\b/.test(t) && (
      /(?:ed\.|trans\.|vol\.|pp?\.|ibid)/i.test(t) ||
      /[A-Z][a-z]+,\s+[A-Z]/.test(t) ||
      /\((?:ed|trans|repr)\./i.test(t)
    );
  });
  if (bibLines.length > lines.length * 0.4 && bibLines.length >= 3) return true;

  // Index / glossary-like chunks: many very short entries
  const shortLines = lines.filter(l => l.trim().length < 40);
  if (shortLines.length > lines.length * 0.7 && lines.length > 5) return true;

  // Book index pages: dense page references like "shadow, 123, 456n, 789ff"
  const pageRefCount = (content.match(/\b\d{1,4}(?:\s*[nf]{1,2})?\b/g) || []).length;
  const commaCount = (content.match(/,/g) || []).length;
  if (pageRefCount > 15 && commaCount > 10 && pageRefCount / stripped.length > 0.03) return true;

  // Index entries: lines with "keyword, page, page, page" or "see also" patterns
  const indexLines = lines.filter(l => {
    const t = l.trim();
    return (
      /\b(?:see also|see|cf\.)\b/i.test(t) ||
      /\b\d{1,4}[nf]{0,2}\s*[,/]\s*\d{1,4}/.test(t) ||
      /\b(?:fig|figs|pl|pls)\.\s*\d/i.test(t) ||
      /,\s*\d{1,4}[nf]{0,2}\s*(?:,\s*\d{1,4}[nf]{0,2}\s*){2,}/.test(t)
    );
  });
  if (indexLines.length > lines.length * 0.3 && indexLines.length >= 3) return true;

  // Figure/plate listing chunks
  const figLines = lines.filter(l => /(?:fig(?:ure)?s?\.|plate|illustration)\s*\d/i.test(l.trim()));
  if (figLines.length > lines.length * 0.4) return true;

  // Dense parenthetical references: "(par. 123)", "(p. 45)", "(vol. 2)"
  const parRefCount = (content.match(/\((?:par|pars|p|pp|vol|fig|figs|pl)\.\s*\d/gi) || []).length;
  if (parRefCount > 5 && parRefCount / lines.length > 0.5) return true;

  return false;
}

// Score how likely a line is a footnote/citation (0 = content, higher = more likely footnote)
function footnoteScore(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;

  let score = 0;
  const cjkCount = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonSpaceLen = trimmed.replace(/\s/g, '').length;

  // Reference keywords
  if (/(?:参见|转引|载于|收录于|同上|原文如下|英编者|编者按)/.test(trimmed)) score += 4;
  // Page/volume references
  if (/第\d+[卷页着章节]/.test(trimmed)) score += 3;
  if (/第\d+栏/.test(trimmed)) score += 3;
  // Parenthetical page references
  if (/[,，]\s*第\d+/.test(trimmed)) score += 2;
  // Book title with page ref
  if (/《.{1,50}》.*第\d+/.test(trimmed)) score += 3;
  // Starts with indentation
  if (/^\s{1,4}\S/.test(line) && cjkCount < nonSpaceLen * 0.4) score += 2;
  // Latin citation patterns
  if (/(?:pp?\.\s*\d|vol\.\s*\d|ibid|op\.\s*cit)/i.test(trimmed)) score += 5;
  // High Latin ratio with few CJK
  if (nonSpaceLen > 10 && cjkCount / nonSpaceLen < 0.2) score += 3;
  // Publisher/editor patterns
  if (/(?:译[,，]|编[,，]|著[,，])/.test(trimmed) && cjkCount < 15) score += 3;
  // Orphaned short reference fragments
  if (nonSpaceLen < 20 && /\d{3,}/.test(trimmed) && cjkCount < 3) score += 5;
  // Line ends with page number pattern like "(170)" or "《183)"
  if (/[《(]\d{1,4}[)》]\s*$/.test(trimmed)) score += 2;

  return score;
}

function cleanText(text: string): string {
  let t = text;

  // Normalize line endings
  t = t.replace(/\r\n/g, '\n');

  // Remove non-printable / zero-width characters
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  t = t.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');

  // Remove HTML comments
  t = t.replace(/<!--[\s\S]*?-->/g, '');

  // Remove page separator blocks: "---\n**第 X 页**\n"
  t = t.replace(/\n*-{3,}\n\s*\*{1,2}第\s*\d+\s*页\*{1,2}\s*\n*/g, '\n');

  // Remove standalone page markers
  t = t.replace(/^\s*\*{1,2}第\s*\d+\s*页\*{1,2}\s*$/gm, '');
  t = t.replace(/^\s*-?\s*\d{1,4}\s*-?\s*$/gm, '');
  t = t.replace(/^\s*第\s*\d+\s*页\s*$/gm, '');
  t = t.replace(/^\s*Page\s+\d+\s*$/gim, '');

  // Remove horizontal rules
  t = t.replace(/^\s*[-*_=]{3,}\s*$/gm, '');

  // Remove running page headers (handle both ASCII and Unicode quotes)
  t = t.replace(/^\s*第[一二三四五六七八九十\d]+部分\s*["""]?\d*\s*$/gm, '');
  t = t.replace(/^\s*\d{1,4}\s+原型与[集全]体无[意总]识\s*$/gm, '');

  // Remove footnote markers inline
  t = t.replace(/C\d+\)/g, '');
  t = t.replace(/\(\d+\)/g, '');
  t = t.replace(/\[注?\d+\]/g, '');
  t = t.replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, '');

  // Remove publishing / copyright / CIP lines
  t = t.replace(/^\s*(版权所有|Copyright|All [Rr]ights [Rr]eserved|ISBN|出版社|出版日期|印刷|定价|书号|图书在版编目|中国版本图书馆|责任编辑|策划编辑|统筹监制|特约编辑|美术编辑|市场推广|出版发行|经\s*销|印\s*[刷WA]|开\s*本|版\s*次|书\s*号|E—mail|http:\/\/|邮编|总编|销售热线|传真).*$/gm, '');

  // Remove markdown table artifacts
  t = t.replace(/^\s*\|[\s\-|:]+\|\s*$/gm, '');
  t = t.replace(/^\s*\|\s+/gm, '');

  // Per-line cleaning: OCR noise + footnote scoring
  const lines = t.split('\n');
  const cleanedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (!trimmed) { cleanedLines.push(''); continue; }

    const cjkCount = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const nonSpaceLen = trimmed.replace(/\s/g, '').length;

    // Pure garbage line: no CJK and mostly random chars with big whitespace gaps
    if (cjkCount === 0 && nonSpaceLen > 3) {
      const hasLargeGaps = (trimmed.match(/\s{3,}/g) || []).length >= 2;
      if (hasLargeGaps && nonSpaceLen < 30) continue;
      if (nonSpaceLen < 15 && hasLargeGaps) continue;
    }

    // Lines with very few CJK chars and big whitespace gaps
    if (nonSpaceLen > 10 && cjkCount < 3 && cjkCount / nonSpaceLen < 0.15) {
      if ((trimmed.match(/\s{3,}/g) || []).length >= 2) continue;
    }

    // Lines of mostly short tokens with almost no CJK (OCR column artifacts)
    const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length >= 4) {
      const shortTokens = tokens.filter(t => t.length <= 3).length;
      if (shortTokens / tokens.length > 0.7 && cjkCount < 5) continue;
    }

    // Score-based footnote removal: high-scoring lines are footnotes
    const fnScore = footnoteScore(trimmed);
    if (fnScore >= 6) continue;

    // Clean inline OCR noise from Chinese-dominant lines
    let cleaned = trimmed;
    if (cjkCount >= 5) {
      // Remove trailing ASCII gibberish
      cleaned = cleaned
        .replace(/\s{2,}[A-Za-z\s.,;:=~*&@#$^!?<>|\\/{}\[\]()]{2,}\s*$/, '')
        .replace(/\s{2,}[A-Z][a-z]?\s*$/, '')
        .trimEnd();
      // Remove isolated short ASCII tokens between CJK (OCR artifacts like " SS ", " Hh, ")
      cleaned = cleaned.replace(/([\u4e00-\u9fff])\s{2,}[A-Za-z]{1,4}(?:\s{2,}|$)/g, '$1');
      // Remove trailing OCR noise like "和PN", "RN", " Sy"
      cleaned = cleaned.replace(/\s+[A-Z]{1,3}\s*$/, '').trimEnd();
      // Remove number+% OCR artifacts (like "574%")
      cleaned = cleaned.replace(/\s+\d{2,4}%/g, '');
    }

    cleanedLines.push(cleaned);
  }
  t = cleanedLines.join('\n');

  // Skip front matter: find first real content paragraph
  const frontMatterEnd = t.search(/\n\d{1,3}\s{2,}[\u4e00-\u9fff]/);
  if (frontMatterEnd > 0 && frontMatterEnd < t.length * 0.1) {
    t = t.slice(frontMatterEnd);
  }

  // Remove multi-line translator/editor notes: [本文最初发表在...英编者] blocks
  t = t.replace(/\s*\[本文[^[\]]{10,500}编者\]\s*/g, ' ');

  // Remove orphaned short reference lines (< 30 chars with page/vol refs or pure numbers)
  t = t.replace(/^\s*第\d+[卷着]第?\d*[页栏节].*$/gm, '');
  t = t.replace(/^\s*\d{4,}\s*[),）]\s*$/gm, '');

  // Remove lines that are just names + book titles (orphaned citation fragments)
  t = t.replace(/^\s*\S{1,8}\s+(FIRS|AA|RAS)\s.*$/gm, '');

  // Remove lines starting with "=:" (OCR artifact for footnote markers)
  t = t.replace(/^\s*=:\s/gm, '');

  // Paragraph-level footnote block removal:
  // Find consecutive lines where avg footnoteScore > 3 and remove the block
  const paragraphs = t.split(/\n\n+/);
  const filtered = paragraphs.filter(para => {
    const pLines = para.split('\n').filter(l => l.trim());
    if (pLines.length === 0) return false;
    const avgScore = pLines.reduce((sum, l) => sum + footnoteScore(l), 0) / pLines.length;
    const cjkTotal = (para.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const totalLen = para.replace(/\s/g, '').length;
    // Drop paragraphs that are heavily footnote-like
    if (avgScore >= 3 && cjkTotal / Math.max(totalLen, 1) < 0.35) return false;
    return true;
  });
  t = filtered.join('\n');

  // Remove isolated single blank lines within paragraphs (OCR page-layout artifacts)
  t = t.replace(/([^\n])\n\n([^\n])/g, '$1\n$2');

  // Collapse multiple blank lines
  t = t.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace per line
  t = t.split('\n').map(line => line.trimEnd()).join('\n');

  return t.trim();
}

function isNoiseChunk(content: string): boolean {
  const stripped = content.replace(/\s+/g, '');
  if (stripped.length < 30) return true;

  const cjkCount = (stripped.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const totalLen = stripped.length;

  // Must have substantial CJK content
  if (cjkCount / totalLen < 0.15) return true;

  // Repetitive short lines (headers/footers)
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length > 0 && lines.every(l => l.trim().length < 10)) return true;

  // Heavy parenthetical/bracket content with low CJK (citation chunks)
  const parenCount = (stripped.match(/[()（）《》\[\]]/g) || []).length;
  if (parenCount / totalLen > 0.12 && cjkCount / totalLen < 0.35) return true;

  // Score each line's footnote likelihood; if majority are footnote-like, drop chunk
  const fnScores = lines.map(l => footnoteScore(l));
  const highScoreLines = fnScores.filter(s => s >= 3).length;
  if (highScoreLines / Math.max(lines.length, 1) > 0.5 && cjkCount / totalLen < 0.4) return true;

  // Too many Latin words relative to Chinese (likely a citation-heavy chunk)
  const latinWords = (content.match(/[a-zA-Z]{3,}/g) || []).length;
  const cjkSentences = (content.match(/[\u4e00-\u9fff]{4,}/g) || []).length;
  if (latinWords > 8 && cjkSentences < 3 && cjkCount / totalLen < 0.3) return true;

  return false;
}

function detectLanguage(text: string): 'zh' | 'en' {
  const sample = text.slice(0, 5000);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > sample.length * 0.1 ? 'zh' : 'en';
}

async function processFile(filePath: string): Promise<{ title: string; content: string; index: number }[]> {
  const ext = path.extname(filePath).toLowerCase();
  let text: string;

  if (ext === '.pdf') {
    text = await parsePdf(filePath);
  } else if (ext === '.md' || ext === '.txt') {
    text = fs.readFileSync(filePath, 'utf-8');
  } else {
    console.log(`  Skipping unsupported file: ${filePath}`);
    return [];
  }

  const lang = detectLanguage(text);
  console.log(`  Detected language: ${lang}`);

  if (lang === 'en') {
    text = cleanEnglishText(text);
  } else {
    text = cleanText(text);
  }

  if (text.length < 50) {
    console.log(`  Skipping empty/tiny file: ${filePath}`);
    return [];
  }

  const raw = chunkText(text, path.basename(filePath), lang);

  const noiseFilter = lang === 'en' ? isEnglishNoiseChunk : isNoiseChunk;
  // Post-chunk cleaning for Chinese texts
  const postCleaned = lang === 'zh' ? raw.map(c => {
    const lines = c.content.split('\n');
    const good = lines.filter(line => {
      const t = line.trim();
      if (!t) return true;
      const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
      const nonSpace = t.replace(/\s/g, '').length;
      if (nonSpace < 25 && cjk < 3 && /[a-zA-Z]/.test(t)) return false;
      if (/^第?\d+[卷页着栏]/.test(t) && nonSpace < 20) return false;
      if (nonSpace < 15 && cjk === 0) return false;
      return true;
    });
    return { ...c, content: good.join('\n').trim() };
  }) : raw;

  const cleaned = postCleaned.filter(c => !noiseFilter(c.content));
  const dropped = raw.length - cleaned.length;
  if (dropped > 0) {
    console.log(`  Dropped ${dropped} noise chunks (${raw.length} → ${cleaned.length}).`);
  }
  return cleaned;
}

async function main() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.error(`Knowledge directory not found: ${KNOWLEDGE_DIR}`);
    console.error('Create the directory and add PDF/Markdown files first.');
    process.exit(1);
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.pdf', '.md', '.txt'].includes(ext);
  });

  if (files.length === 0) {
    console.log('No PDF/Markdown/TXT files found in knowledge/ directory.');
    process.exit(0);
  }

  console.log(`Found ${files.length} file(s) to process.\n`);

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      chunk_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insertStmt = db.prepare(
    'INSERT INTO knowledge_chunks (source_file, title, content, embedding, chunk_index) VALUES (?, ?, ?, ?, ?)'
  );

  let totalChunks = 0;

  for (const file of files) {
    const filePath = path.join(KNOWLEDGE_DIR, file);
    console.log(`Processing: ${file}`);

    const existingCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE source_file = ?'
    ).get(file) as { cnt: number }).cnt;

    if (existingCount > 0) {
      console.log(`  Already indexed (${existingCount} chunks). Skipping. Use --force to re-index.`);
      if (!process.argv.includes('--force')) continue;
      db.prepare('DELETE FROM knowledge_chunks WHERE source_file = ?').run(file);
      console.log(`  Cleared ${existingCount} old chunks.`);
    }

    const chunks = await processFile(filePath);
    if (chunks.length === 0) continue;
    console.log(`  Split into ${chunks.length} chunks.`);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => `${c.title}\n${c.content}`);

      console.log(`  Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}...`);
      const embeddings = await embedBatch(texts);

      const tx = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const vec = embeddings[j];
          const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
          insertStmt.run(file, batch[j].title, batch[j].content, buf, batch[j].index);
        }
      });
      tx();

      if (i + BATCH_SIZE < chunks.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    totalChunks += chunks.length;
    console.log(`  Done. ${chunks.length} chunks indexed.\n`);
  }

  db.close();
  console.log(`\nIngestion complete. Total: ${totalChunks} new chunks.`);
  console.log('Run POST /api/knowledge-reload to refresh the in-memory cache.');
}

main().catch(err => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
