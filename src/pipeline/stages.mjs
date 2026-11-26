/**
 * Stage orchestration for all three tiers (quick / standard / deep):
 * analysts → multi-round debate → research manager → trader proposal →
 * (standard/deep) risk three-party + risk manager review(s) → final trader verdict.
 * Tier matrix: `design/pipeline.md` §2/§7.1.
 *
 * Contract: `<DOCS>/design/pipeline.md` §2/§7.1, `pipeline-runtime.md` §4–§5.
 */
import { CATEGORY_KEYS, fetchSnapshot } from '../data/index.mjs';
import { ROLES, dataSlice, roleReportsDigest } from './roles.mjs';
import * as prompts from './prompts.mjs';
import { parseVerdict, VerdictError } from './verdict.mjs';
import { buildReport, saveReport } from './report.mjs';

export class PipelineError extends Error {
  /** @param {string} code @param {string} message @param {any} [data] */
  constructor(code, message, data) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export const TIER_PLANS = {
  quick: { analysts: ['market', 'fundamentals', 'news'], debateRounds: 1, risk: false, reviews: 0 },
  standard: {
    analysts: ['market', 'fundamentals', 'news', 'social', 'macro', 'smart_money', 'volume_price'],
    debateRounds: 2,
    risk: true,
    reviews: 1,
  },
  deep: {
    analysts: ['market', 'fundamentals', 'news', 'social', 'macro', 'smart_money', 'volume_price'],
    debateRounds: 3,
    risk: true,
    reviews: 2,
  },
};

/** Role-level verdict shape is frozen by design/report.md §2: direction/confidence/reason. */
function roleVerdict(verdict) {
  if (!verdict) return null;
  return { direction: verdict.direction, confidence: verdict.confidence, reason: verdict.oneLineReason ?? '' };
}

/** @param {any} onEvent @param {any} event */
function emit(onEvent, event) {
  if (typeof onEvent === 'function') onEvent(event);
}

/**
 * One LLM call expected to carry a VERDICT; one repair attempt when parsing fails.
 * @param {{
 *   llm: any, roleId: string, prompt: {system: string, user: string},
 *   signal?: AbortSignal, maxTokens?: number,
 * }} options
 */
async function callWithVerdict({ llm, roleId, prompt, signal, maxTokens }) {
  const first = await llm.call({
    slot: 'analysts',
    system: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
    maxTokens,
    signal,
  });
  let verdict = parseVerdict(first.text);
  if (!verdict) {
    const repair = prompts.buildVerdictRepairPrompt(first.text, '未找到或无法解析 VERDICT json 块');
    const second = await llm.call({
      slot: 'analysts',
      system: repair.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: repair.user }] }],
      maxTokens: 800,
      signal,
    });
    verdict = parseVerdict(second.text);
  }
  if (!verdict) throw new VerdictError(`${roleId} 两次输出都缺少合法 VERDICT`);
  return { text: first.text, verdict };
}

/**
 * Quick tier: returns the saved report descriptor.
 * @param {{
 *   symbol: string, tradeDate: string, llm: any, config: any,
 *   data?: { fetchSnapshot: Function }, onEvent?: (event: any) => void,
 *   signal?: AbortSignal, homeDir?: string,
 * }} options
 */
/**
 * Run one tier. Standard/deep add the risk three-party debate and risk-manager
 * reviews; quick skips them (`TIER_PLANS`).
 * @param {{
 *   symbol: string, tradeDate?: string, tier?: 'quick'|'standard'|'deep',
 *   llm: any, config: any,
 *   data?: { fetchSnapshot: Function }, onEvent?: (event: any) => void,
 *   signal?: AbortSignal, homeDir?: string,
 * }} options
 */
export async function runTier({ symbol, tradeDate, tier = 'quick', llm, config, data = { fetchSnapshot }, onEvent, signal, homeDir }) {
  const plan = TIER_PLANS[tier];
  if (!plan) throw new PipelineError('TIER_NOT_IMPLEMENTED', `未实现档位：${tier}`);
  emit(onEvent, { type: 'phase', phase: 'validate', message: `校验 ${symbol} / ${tradeDate ?? 'today'}` });

  let snapshot;
  try {
    snapshot = await data.fetchSnapshot({ symbol, tradeDate, categories: CATEGORY_KEYS, signal });
  } catch (error) {
    if (error?.name === 'InputRejectedError') throw new PipelineError(error.code, error.message, { attempts: error.attempts ?? [] });
    throw error;
  }
  if (snapshot.fatal) {
    const attempts = snapshot.categories?.quote?.attempts ?? [];
    throw new PipelineError('QUOTE_UNAVAILABLE', '行情不可用，无法生成报告', { attempts });
  }
  // `tradeDate` is optional in the API; the data layer resolves it (today in
  // Asia/Shanghai). Everything downstream (prompts, report id, storage) must
  // use the resolved date, never the raw undefined input.
  tradeDate = snapshot.tradeDate ?? tradeDate;
  const missing = snapshot.missing ?? [];
  const name = snapshot.categories?.quote?.data?.name
    ?? snapshot.categories?.fundamentals?.data?.valuation?.name
    ?? null;
  emit(onEvent, {
    type: 'phase', phase: 'snapshot', index: 1, total: 1,
    message: `数据准备完成（缺口：${missing.length ? missing.join('、') : '无'}）`,
    data: { missing, snapshotAt: snapshot.snapshotAt },
  });

  /** @type {Record<string, { text: string, verdict: any }>} */
  const reports = {};
  const roleEntries = [];
  const gaps = [...missing];
  /** @type {string[]} */
  const analystFailures = [];

  const directionZh = { bullish: '看多', bearish: '看空', neutral: '中性' };
  let done = 0;
  await Promise.all(plan.analysts.map(async (roleId) => {
    if (signal?.aborted) throw new PipelineError('CANCELLED', '分析已取消');
    const role = ROLES[roleId];
    const { slice, gaps: roleGaps } = dataSlice(roleId, snapshot.categories, missing);
    const prompt = prompts.buildAnalystPrompt(role, {
      symbol, name, tradeDate, slice, gaps: roleGaps, userView: null,
    });
    let failureText = '';
    try {
      const result = await callWithVerdict({ llm, roleId, prompt, signal });
      reports[roleId] = result;
      roleEntries.push({ id: role.id, title: role.title, verdict: roleVerdict(result.verdict), reportMd: result.text });
    } catch (error) {
      if (signal?.aborted) throw new PipelineError('CANCELLED', '分析已取消');
      failureText = `${error?.code ?? 'ERROR'} ${String(error?.message ?? '').slice(0, 160)}`;
      analystFailures.push({ roleId, title: role.title, message: error?.message ?? String(error) });
      gaps.push(`${role.title}失败：${error?.code ?? 'ERROR'} ${error?.message ?? ''}`.trim());
      roleEntries.push({ id: role.id, title: role.title, verdict: null, reportMd: `（该角色失败：${error?.message ?? 'unknown'}）` });
    }
    done += 1;
    emit(onEvent, {
      type: 'item', phase: 'analysts', index: done, total: plan.analysts.length,
      message: `分析师 ${done}/${plan.analysts.length} 完成${reports[roleId]?.verdict ? ` · ${role.title} ${directionZh[reports[roleId].verdict.direction] ?? reports[roleId].verdict.direction}` : ` · ${role.title} 失败：${failureText}`}`,
    });
  }));

  const requiredAnalysts = Math.ceil(plan.analysts.length * 0.7);
  const successfulAnalysts = plan.analysts.length - analystFailures.length;
  if (successfulAnalysts < requiredAnalysts) {
    throw new PipelineError('ANALYST_FAILURE', `分析师成功率不足（${successfulAnalysts}/${plan.analysts.length}，要求 ≥${requiredAnalysts}）`, { failures: analystFailures });
  }

  const analystDigest = roleReportsDigest(reports, plan.analysts);
  const debate = { rounds: plan.debateRounds, bull: [], bear: [] };
  /** @type {Record<string, { text: string, verdict: any }>} */
  const debateReports = {};
  for (let round = 1; round <= plan.debateRounds; round += 1) {
    const bull = await callWithVerdict({
      llm,
      roleId: 'bull',
      prompt: prompts.buildDebatePrompt('bull', { round, reports: analystDigest, previous: debate.bear.at(-1) ?? null, symbol, tradeDate }),
      signal,
    });
    debate.bull.push({ round, text: bull.text });
    debateReports.bull = bull;
    emit(onEvent, { type: 'item', phase: 'debate', index: round, total: plan.debateRounds, message: `辩论 ${round}/${plan.debateRounds} · 多头完成` });

    const bear = await callWithVerdict({
      llm,
      roleId: 'bear',
      prompt: prompts.buildDebatePrompt('bear', { round, reports: analystDigest, previous: bull.text, symbol, tradeDate }),
      signal,
    });
    debate.bear.push({ round, text: bear.text });
    debateReports.bear = bear;
    emit(onEvent, { type: 'item', phase: 'debate', index: round, total: plan.debateRounds, message: `辩论 ${round}/${plan.debateRounds} · 空头完成` });
  }
  roleEntries.push({ id: 'bull', title: ROLES.bull.title, verdict: roleVerdict(debateReports.bull?.verdict), reportMd: debate.bull.map((item) => item.text).join('\n\n---\n\n') });
  roleEntries.push({ id: 'bear', title: ROLES.bear.title, verdict: roleVerdict(debateReports.bear?.verdict), reportMd: debate.bear.map((item) => item.text).join('\n\n---\n\n') });

  const research = await callWithVerdict({
    llm,
    roleId: 'research_manager',
    prompt: prompts.buildResearchPrompt({ symbol, tradeDate, reports: analystDigest, debate }),
    signal,
  });
  roleEntries.push({ id: 'research_manager', title: ROLES.research_manager.title, verdict: roleVerdict(research.verdict), reportMd: research.text });
  emit(onEvent, { type: 'phase', phase: 'research', message: '研究收敛完成' });

  let proposal;
  try {
    proposal = await callWithVerdict({
      llm,
      roleId: 'trader',
      prompt: prompts.buildTraderPrompt({ symbol, tradeDate, plan: research.text, reports: analystDigest }),
      signal,
    });
  } catch (error) {
    throw new PipelineError('JUDGE_FAILURE', `交易员提案失败：${error.message}`);
  }
  roleEntries.push({ id: 'trader-proposal', title: '交易员（初版）', verdict: roleVerdict(proposal.verdict), reportMd: proposal.text });
  emit(onEvent, { type: 'phase', phase: 'trader', message: '交易提案完成' });

  const risk = { aggressive: null, conservative: null, neutral: null, managerFeedback: null };
  let final_;
  if (plan.risk) {
    // Aggressive + conservative in parallel, neutral last (design §2 stage 7).
    const [aggressive, conservative] = await Promise.all([
      callWithVerdict({ llm, roleId: 'risk_aggressive', prompt: prompts.buildRiskPrompt('aggressive', { symbol, proposal: proposal.text, plan: research.text }), signal }),
      callWithVerdict({ llm, roleId: 'risk_conservative', prompt: prompts.buildRiskPrompt('conservative', { symbol, proposal: proposal.text, plan: research.text }), signal }),
    ]);
    emit(onEvent, { type: 'item', phase: 'risk', index: 1, total: 3, message: '风控三方 · 激进完成' });
    emit(onEvent, { type: 'item', phase: 'risk', index: 2, total: 3, message: '风控三方 · 保守完成' });
    const neutral = await callWithVerdict({ llm, roleId: 'risk_neutral', prompt: prompts.buildRiskPrompt('neutral', { symbol, proposal: proposal.text, plan: research.text }), signal });
    emit(onEvent, { type: 'item', phase: 'risk', index: 3, total: 3, message: '风控三方 · 中性完成' });
    risk.aggressive = aggressive.text;
    risk.conservative = conservative.text;
    risk.neutral = neutral.text;
    for (const [id, result] of [['risk_aggressive', aggressive], ['risk_conservative', conservative], ['risk_neutral', neutral]]) {
      roleEntries.push({ id, title: ROLES[id].title, verdict: roleVerdict(result.verdict), reportMd: result.text });
    }

    const review = await callWithVerdict({
      llm,
      roleId: 'risk_manager',
      prompt: prompts.buildRiskManagerPrompt({ symbol, proposal: proposal.text, risk }),
      signal,
    });
    risk.managerFeedback = review.text;
    roleEntries.push({ id: 'risk_manager', title: ROLES.risk_manager.title, verdict: roleVerdict(review.verdict), reportMd: review.text });
    emit(onEvent, { type: 'phase', phase: 'risk-review', message: '风控复核完成' });

    final_ = await callWithVerdict({
      llm,
      roleId: 'trader-final',
      prompt: prompts.buildTraderPrompt({ symbol, tradeDate, plan: research.text, reports: analystDigest, riskFeedback: review.text }),
      signal,
    });

    if (plan.reviews >= 2) {
      const finalReview = await callWithVerdict({
        llm,
        roleId: 'risk_manager',
        prompt: prompts.buildRiskManagerPrompt({ symbol, proposal: final_.text, risk }),
        signal,
      });
      roleEntries.push({ id: 'risk_manager-final', title: '风控经理（终审复核）', verdict: roleVerdict(finalReview.verdict), reportMd: finalReview.text });
      emit(onEvent, { type: 'phase', phase: 'risk-review', message: '终审复核完成' });
      final_ = await callWithVerdict({
        llm,
        roleId: 'trader-final',
        prompt: prompts.buildTraderPrompt({
          symbol, tradeDate, plan: research.text, reports: analystDigest,
          riskFeedback: `${review.text}\n\n${finalReview.text}`,
        }),
        signal,
      });
    }
  } else {
    final_ = await callWithVerdict({
      llm,
      roleId: 'trader-final',
      prompt: prompts.buildTraderPrompt({ symbol, tradeDate, plan: research.text, reports: analystDigest, riskFeedback: null }),
      signal,
    });
  }
  roleEntries.push({ id: 'trader', title: '交易员（终审）', verdict: roleVerdict(final_.verdict), reportMd: final_.text });
  emit(onEvent, { type: 'phase', phase: 'final', message: '终审完成' });

  const now = new Date();
  const generatedAt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type) => generatedAt.find((part) => part.type === type)?.value ?? '00';
  const generatedIso = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;

  const report = buildReport({
    symbol,
    name,
    tradeDate,
    tier,
    models: {
      analysts: { provider: config.analysts.provider, model: config.analysts.model, effort: config.analysts.effort },
      judge: { provider: config.judge.provider, model: config.judge.model, effort: config.judge.effort },
      usage: llm.usage(),
    },
    snapshot,
    intent: null,
    roles: roleEntries,
    debate,
    risk,
    verdict: final_.verdict,
    gaps,
    generatedAt: generatedIso,
  });
  const saved = await saveReport(report, homeDir ? { homeDir } : {});
  emit(onEvent, { type: 'phase', phase: 'report', message: `报告已落盘 ${saved.id}` });
  return { report, ...saved };
}

/** Backward-compatible quick-tier entry point. */
export function runQuickTier(options) {
  return runTier({ ...options, tier: 'quick' });
}
