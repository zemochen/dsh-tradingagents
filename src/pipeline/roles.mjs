/**
 * Role catalogue (ids fixed by `design/pipeline.md` §7.1) and data slices.
 * Prompts are built in `prompts.mjs`; orchestration in `stages.mjs`.
 */

/** Which snapshot categories each role receives. */
export const ROLE_DATA = {
  market: ['quote', 'klines'],
  fundamentals: ['fundamentals', 'quote'],
  news: ['news', 'quote'],
  social: ['news', 'quote'],
  macro: ['quote', 'klines', 'sector'],
  smart_money: ['moneyflow', 'dragon_tiger', 'quote'],
  volume_price: ['klines', 'quote', 'moneyflow'],
  bull: [],
  bear: [],
  research_manager: [],
  trader: [],
  risk_aggressive: [],
  risk_conservative: [],
  risk_neutral: [],
  risk_manager: [],
};

/** @typedef {'market'|'fundamentals'|'news'|'social'|'macro'|'smart_money'|'volume_price'|'bull'|'bear'|'research_manager'|'trader'|'risk_aggressive'|'risk_conservative'|'risk_neutral'|'risk_manager'} RoleId */

export const ROLES = {
  market: { id: 'market', title: '技术面分析师', kind: 'analyst' },
  fundamentals: { id: 'fundamentals', title: '基本面分析师', kind: 'analyst' },
  news: { id: 'news', title: '新闻分析师', kind: 'analyst' },
  social: { id: 'social', title: '舆情分析师', kind: 'analyst' },
  macro: { id: 'macro', title: '宏观与板块分析师', kind: 'analyst' },
  smart_money: { id: 'smart_money', title: '机构资金分析师', kind: 'analyst' },
  volume_price: { id: 'volume_price', title: '量价分析师', kind: 'analyst' },
  bull: { id: 'bull', title: '多头研究员', kind: 'debate' },
  bear: { id: 'bear', title: '空头研究员', kind: 'debate' },
  research_manager: { id: 'research_manager', title: '研究经理', kind: 'judge' },
  trader: { id: 'trader', title: '交易员', kind: 'judge' },
  risk_aggressive: { id: 'risk_aggressive', title: '激进风控', kind: 'judge' },
  risk_conservative: { id: 'risk_conservative', title: '保守风控', kind: 'judge' },
  risk_neutral: { id: 'risk_neutral', title: '中性风控', kind: 'judge' },
  risk_manager: { id: 'risk_manager', title: '风控经理', kind: 'judge' },
};

/**
 * @param {RoleId} id
 * @param {Record<string, any>} data  fetchSnapshot().categories
 * @param {string[]} missing
 */
export function dataSlice(id, data, missing) {
  const needs = ROLE_DATA[id] ?? [];
  /** @type {Record<string, any>} */
  const slice = {};
  for (const category of needs) {
    const entry = data?.[category];
    if (entry) slice[category] = { status: entry.status, source: entry.source, asOf: entry.asOf, data: entry.data };
  }
  return { slice, gaps: missing.filter((category) => needs.includes(category)) };
}

/** @param {Record<string, any>} reports roleId -> {text, verdict} */
export function roleReportsDigest(reports, ids) {
  return ids.map((id) => ({
    role: ROLES[id].title,
    verdict: reports[id]?.verdict ?? null,
    text: String(reports[id]?.text ?? '').slice(0, 6_000),
  }));
}
