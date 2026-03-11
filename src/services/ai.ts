import { Message, Mode, SymbolEntry, ProjectionEntry } from '../types';
import type { KnowledgeChunk } from './embedding';

const BASE_INSTRUCTION = `你是炼金术师 (The Alchemy)，一位荣格取向的心理分析师。直觉敏锐、温暖但直接。你会主动给出观察和假设，让用户验证。

回复规则：
- 60-100 字。先给你的分析，再问一个具体的问题
- 用户只是打招呼或闲聊（如"你好""hello""在吗"）时，自然回应即可，不要分析问候本身，直接友善地引导用户说出想聊的事
- 用户说"不知道"时，给出你的假设让用户验证
- 禁止：比喻修辞、心理学术语、生活建议、替用户描述状态、复述用户的话
- 只返回对话文本，不返回 JSON

示例：
用户："我觉得我永远比不上我哥"
好："你哥在你家里好像是个标杆。这个'比不上'的感觉，是你自己的判断，还是家里人也这么暗示过？"
坏："这种感觉像一面镜子，映照出你内心深处的不安。你能联想到什么场景吗？"（比喻+泛问）`;

const SYSTEM_PROMPTS: Record<Mode, string> = {
  'Projection Work': `${BASE_INSTRUCTION}

当前模式：投射工作。
你的目标是帮用户识别心理投射——当我们对某个人有异常强烈的情绪反应时，往往是因为对方触发了我们自己内心未处理的部分。

如何判断这是投射：
- 情绪强度和事件本身不成比例（一件小事却让人暴怒/极度不安）
- 对特定的人反复产生同一种强烈感受
- 特别讨厌某人身上的某个特质，但自己身上也有类似的（只是不愿承认）
- 对某人过度理想化，把ta想得完美无缺

根据对话进展自动推进阶段：
阶段1（用户刚开始倾诉）：搞清楚具体的人和事。然后指出你观察到的投射信号——比如"你对这件事的反应强度好像超过了事情本身，这里面可能不只是对ta的不满"
阶段2（用户认可你的观察）：帮用户看到镜像——"你讨厌ta的这个特质，你自己身上有没有类似的部分？或者你特别害怕自己变成那样？"
阶段3（用户开始有觉察）：帮ta理解这份觉察的意义——这不是要ta原谅对方，而是理解自己内心的需要
阶段4（觉察已经落地）：简短肯定，自然收束。可以问"还有别的想聊的吗？"

关键：判断用户在哪个阶段，只做那个阶段该做的事。如果在同一层面绕圈子，说明该进入下一阶段了。`,

  'Dream Weaver': `${BASE_INSTRUCTION}

当前模式：梦境编织。
用荣格的方法帮用户理解梦在说什么。梦不是伪装，而是无意识用象征语言发出的直接信息。你的目标是帮用户听到这个信息。

根据对话阶段推进：

阶段1（用户刚描述完梦）：用一两句话点出你感受到的核心张力，然后聚焦最有能量的那一个意象，引导用户做个人联想——"这个___让你联想到什么？"。不要直接告诉用户它象征什么，用户自己的联想比通用象征更重要。

阶段2（用户给出联想后）：基于用户的个人联想给出分析。两个关键视角：
- 主观层面：梦中出现的人物先理解为做梦者自己的某一面（阴影、阿尼玛/阿尼姆斯等）
- 补偿视角：这个梦在补偿你清醒时的什么态度？它想告诉你什么你不知道、或不想承认的？
然后继续引导下一个意象的联想。

阶段3（意象都聊完了）：给出这个梦对用户当前心理状态的整体启示——梦在指引你走向哪里？自然收束。

关键原则：
- 每轮回复必须引用梦中的具体意象，不跟着现实话题跑。用户提到现实时，把现实映射回梦的意象
- 你是解梦者，不是生活顾问。一次只聊一个意象
- 严格 100 字以内`,

  'Active Imagination': `${BASE_INSTRUCTION}

当前模式：积极想象。
你是引导者，帮用户沉浸在内心画面里。不分析、不评判。
- 用现在时，调动感官（看到/听到/触到/闻到/感受到）
- 每次只问一个开放式问题，让用户自由描述接下来发生了什么
- 禁止封闭式问题（"是吗？""好吗？""对吗？"）
- 首次对话时，直接带用户进入一个具体场景（森林/海边/山谷/花园/湖泊/古老图书馆）`,

  'Free Talk': `${BASE_INSTRUCTION}

当前模式：自由探索。
用户想聊什么就聊什么。你是一个有洞察力的对话伙伴，不是被动的倾听者。

当用户聊到对某人的强烈情绪时，按投射分析的方式推进：
1. 先指出投射信号（"你对这件事的反应强度好像超过了事情本身"）
2. 帮用户看到镜像（"你讨厌ta的这个特质，你自己身上有没有类似的？"）
3. 觉察落地后收束，不要在已经完成的话题上继续追问

当用户聊到梦境时，直接分析：
1. 先给出梦的整体解读（结构、核心情感、可能的心理含义）
2. 逐个分析重要意象的象征含义
3. 连接到现实生活

其他话题：抓住用户话里值得深入的点，给出你的观察和分析，不需要每次都往心理分析方向走。

再次强调：不要用比喻，不要替用户描述状态，不要讲废话，直接说你的分析。`
};

const INSIGHT_INSTRUCTION = `
如果对话中达成了某个深刻的心理认知（Ah-ha moment），在回复末尾附加一个特殊标记：
[INSIGHT: {"type": "原型id", "content": "洞察描述"}]
其中 type 是对应的原型 id，可选值：self, shadow, anima, animus, persona, hero, wise_old_man, great_mother, puer_aeternus, trickster, child, father
注意：只在真正有深刻洞察时才生成，不要强行生成。`;

const SYMBOL_INSTRUCTION = `
当你在梦境分析中识别到一个重要的个人象征——用户对某个意象表达了明确的情感联想或个人意义，在回复末尾附加：
[SYMBOL: {"term": "象征名称", "meaning": "对这位用户而言的个人含义（20字内）"}]
注意：只在用户确认了某个意象的个人含义时才生成，不要在第一次提到时就生成。每次最多生成一个。`;

const PROJECTION_INSTRUCTION = `
当你帮助用户识别到一个心理投射——用户开始意识到对他人的强烈情绪是自身内在的映射，在回复末尾附加：
[PROJECTION: {"target": "投射对象", "trait": "投射特质", "archetype": "对应原型id"}]
archetype 可选值：shadow, anima, animus, persona, self
注意：只在用户有了初步的自我觉察时才生成，不要过早标记。每次最多生成一个。
去重规则（严格遵守）：
- 生成前先检查下方"已生成的投射"列表中是否有相同 target 的投射
- 如果同一个 target 已有投射，判断新投射是否与已有的在语义上属于同一种心理动力。如果是同一种的不同说法，绝不生成。例如："老板-评判倾向"和"老板-严苛评判"本质相同，不要重复
- 只有当同一 target 的新投射涉及真正不同的心理维度时才可以生成。例如："老板-评判倾向"和"老板-控制欲"是不同的阴影面向，可以分别生成

const SAFETY_PROMPT = `【最高优先级安全指令】
检测到用户可能正在经历心理危机。你必须：
1. 立即停止任何深度心理分析或原型解读
2. 用温暖、平稳的语气回应，表达关心和理解
3. 明确告诉用户你是 AI，不能替代专业帮助
4. 建议用户联系专业心理咨询师或拨打心理援助热线
5. 不要追问细节，不要试图"治疗"
6. 回复控制在 60 字以内
7. 不要生成任何 [INSIGHT]、[SYMBOL]、[PROJECTION] 标签`;

export interface SessionSummary {
  session_id: string;
  mode: string;
  summary: string;
  created_at: string;
}

export interface UserProfile {
  core_patterns: string;
  shadow_themes: string;
  recurring_symbols: string;
  growth_trajectory: string;
}

interface ChatOptions {
  messages: Message[];
  mode: Mode;
  userInput: string;
  userSymbols?: SymbolEntry[];
  userProjections?: ProjectionEntry[];
  isCrisis?: boolean;
  historySummaries?: SessionSummary[];
  userProfile?: UserProfile | null;
  knowledgeChunks?: KnowledgeChunk[];
}

interface ChatResult {
  text: string;
  insight?: { type: string; content: string };
  symbol?: SymbolEntry;
  projection?: ProjectionEntry;
}

interface ArkResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

function buildContextBlock(
  symbols?: SymbolEntry[],
  projections?: ProjectionEntry[],
  summaries?: SessionSummary[],
  profile?: UserProfile | null,
  knowledgeChunks?: KnowledgeChunk[],
): string {
  const parts: string[] = [];

  if (knowledgeChunks && knowledgeChunks.length > 0) {
    parts.push(`\n\n【专业知识参考】（以下是相关的荣格心理学背景知识，可自然融入回复中，不要原文照搬）\n${knowledgeChunks.map((c, i) => `${i + 1}. [${c.title}] ${c.content}`).join('\n')}`);
  }

  if (profile && Object.values(profile).some(v => v)) {
    const dims = [
      profile.core_patterns && `- 核心模式：${profile.core_patterns}`,
      profile.shadow_themes && `- 阴影主题：${profile.shadow_themes}`,
      profile.recurring_symbols && `- 反复象征：${profile.recurring_symbols}`,
      profile.growth_trajectory && `- 成长轨迹：${profile.growth_trajectory}`,
    ].filter(Boolean).join('\n');
    parts.push(`\n\n【用户画像】（长期积累，自然参考即可，不要直接告诉用户你知道这些）\n${dims}`);
  }

  if (summaries && summaries.length > 0) {
    parts.push(`\n\n【近期探索】（最近几次对话，可以适时提及以保持连续性）\n${summaries.map((s, i) => `${i + 1}. ${s.summary}`).join('\n')}`);
  }

  if (symbols && symbols.length > 0) {
    parts.push(`\n\n用户已确认的个人象征词典（在解梦时参考）：\n${symbols.map(s => `- ${s.term}: ${s.meaning}`).join('\n')}`);
  }

  if (projections && projections.length > 0) {
    const active = projections.filter(p => p.status === 'active');
    if (active.length > 0) {
      parts.push(`\n\n用户当前活跃的投射记录（在投射工作中参考）：\n${active.map(p => `- 对"${p.target}"投射了"${p.trait}"（对应原型：${p.archetype}）`).join('\n')}`);
    }
  }

  return parts.join('');
}

export async function chat({ messages, mode, userInput, userSymbols, userProjections, isCrisis, historySummaries, userProfile, knowledgeChunks }: ChatOptions): Promise<ChatResult> {
  let systemPrompt = SYSTEM_PROMPTS[mode] + INSIGHT_INSTRUCTION;

  if (mode === 'Dream Weaver') {
    systemPrompt += SYMBOL_INSTRUCTION;
  } else if (mode === 'Projection Work') {
    systemPrompt += PROJECTION_INSTRUCTION;
    const projByTarget = new Map<string, string[]>();
    for (const m of messages) {
      if (!m.projection) continue;
      const { target, trait, archetype } = m.projection;
      if (!projByTarget.has(target)) projByTarget.set(target, []);
      projByTarget.get(target)!.push(`"${trait}"（${archetype}）`);
    }
    if (projByTarget.size > 0) {
      const lines = [...projByTarget.entries()].map(
        ([target, traits]) => `- ${target}：${traits.join('、')}`
      );
      systemPrompt += `\n\n【本次对话已生成的投射，同 target 下语义相同的不要重复】：\n${lines.join('\n')}`;
    }
  }

  systemPrompt += buildContextBlock(userSymbols, userProjections, historySummaries, userProfile, knowledgeChunks);

  if (isCrisis) {
    systemPrompt = SYSTEM_PROMPTS[mode] + '\n\n' + SAFETY_PROMPT;
  }

  const arkMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userInput },
  ];

  const res = await fetchWithRetry('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: arkMessages,
      ...(mode === 'Dream Weaver' ? { max_tokens: 200 } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Chat API error: ${res.status}`);
  }

  const data: ArkResponse = await res.json();
  let text = data.choices?.[0]?.message?.content || '';

  let insight: ChatResult['insight'];
  let symbol: ChatResult['symbol'];
  let projection: ChatResult['projection'];

  const insightMatch = text.match(/\[INSIGHT:\s*(.*?)\]/);
  if (insightMatch) {
    try { insight = JSON.parse(insightMatch[1]); } catch {}
    text = text.replace(/\[INSIGHT:\s*.*?\]/, '').trim();
  }

  const symbolMatch = text.match(/\[SYMBOL:\s*(.*?)\]/);
  if (symbolMatch) {
    try { symbol = JSON.parse(symbolMatch[1]); } catch {}
    text = text.replace(/\[SYMBOL:\s*.*?\]/, '').trim();
  }

  const projectionMatch = text.match(/\[PROJECTION:\s*(.*?)\]/);
  if (projectionMatch) {
    try { projection = JSON.parse(projectionMatch[1]); } catch {}
    text = text.replace(/\[PROJECTION:\s*.*?\]/, '').trim();
  }

  return { text, insight, symbol, projection };
}

// --- Archetype Dialogue ---

export interface ArchetypeContext {
  archetype: { personal_manifestation: string; integration_score: number } | null;
  projections: { target: string; trait: string; status: string }[];
  symbols: { term: string; meaning: string }[];
  profile: { core_patterns: string; shadow_themes: string; recurring_symbols: string; growth_trajectory: string } | null;
  recentSummaries: { summary: string; mode: string }[];
}

function buildArchetypeUserContext(ctx: ArchetypeContext): string {
  const parts: string[] = [];

  if (ctx.profile) {
    const dims = [
      ctx.profile.core_patterns && `核心模式：${ctx.profile.core_patterns}`,
      ctx.profile.shadow_themes && `阴影主题：${ctx.profile.shadow_themes}`,
      ctx.profile.recurring_symbols && `反复象征：${ctx.profile.recurring_symbols}`,
      ctx.profile.growth_trajectory && `成长轨迹：${ctx.profile.growth_trajectory}`,
    ].filter(Boolean);
    if (dims.length > 0) parts.push(`关于这位用户：\n${dims.join('\n')}`);
  }

  if (ctx.archetype?.personal_manifestation) {
    parts.push(`用户在你身上积累的洞察：\n${ctx.archetype.personal_manifestation}`);
  }

  if (ctx.projections.length > 0) {
    parts.push(`与你相关的投射：\n${ctx.projections.map(p => `- 对"${p.target}"投射了"${p.trait}"（${p.status === 'integrated' ? '已整合' : '活跃'}）`).join('\n')}`);
  }

  if (ctx.symbols.length > 0) {
    parts.push(`用户的个人象征：\n${ctx.symbols.map(s => `- ${s.term}: ${s.meaning}`).join('\n')}`);
  }

  if (ctx.recentSummaries.length > 0) {
    parts.push(`用户近期的探索：\n${ctx.recentSummaries.map((s, i) => `${i + 1}. ${s.summary}`).join('\n')}`);
  }

  return parts.length > 0 ? '\n\n【你对这位用户的了解】\n' + parts.join('\n\n') : '';
}

export async function chatWithArchetype(
  archetypeVoice: string,
  userContext: ArchetypeContext,
  messages: Message[],
  userInput: string,
): Promise<string> {
  const systemPrompt = archetypeVoice + buildArchetypeUserContext(userContext);

  const arkMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userInput },
  ];

  const res = await fetchWithRetry('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: arkMessages }),
  });

  if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
  const data: ArkResponse = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0) {
      return fetchWithRetry(url, options, retries - 1);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
