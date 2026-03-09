const CRISIS_PATTERNS = [
  /自杀/, /想死/, /不想活/, /结束生命/, /了断/,
  /自残/, /割腕/, /自我伤害/, /伤害自己/,
  /跳楼/, /跳河/, /跳桥/, /上吊/,
  /吃[了要]?药[自死]/, /过量服药/, /安眠药/,
  /活着没意思/, /活不下去/, /生无可恋/,
  /suicide/, /kill\s*my\s*self/, /end\s*(my|it)\s*all/i,
  /self[- ]?harm/i, /cut\s*my/i, /want\s*to\s*die/i,
];

export function detectCrisis(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return CRISIS_PATTERNS.some(p => p.test(normalized) || p.test(text));
}

export const HOTLINES = [
  { name: '全国24小时心理援助热线', number: '400-161-9995' },
  { name: '北京心理危机研究与干预中心', number: '010-82951332' },
  { name: '生命热线', number: '400-821-1215' },
];

export const DISCLAIMER = '本应用为 AI 辅助自我探索工具，不能替代专业心理咨询或医疗诊断。如果你正在经历心理危机，请立即联系专业援助。';
