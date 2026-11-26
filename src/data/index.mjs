/**
 * 数据层唯一出口：`fetchSnapshot`。
 *
 * 契约见 `<DOCS>/design/data-layer.md`：
 * - 输入非法（代码 / 未来日期 / 非交易日 / 日历不可用）→ 抛 `InputRejectedError`，不产出快照；
 * - 数据获取失败 → 类别进 `missing`，`quote` 缺失置 `fatal`，**永不抛数据不可用给上层**；
 * - 每类数据带 `status` / 来源 / 抓取时间 / 数据时点 / 完整 attempts。
 */
import { CODES, InputRejectedError, toAttemptError } from './errors.mjs';
import { assertTradingDay } from './calendar.mjs';
import { nowIsoShanghai, parseSymbol, todayShanghai } from './normalize.mjs';
import * as eastmoney from './providers/eastmoney.mjs';
import * as tencent from './providers/tencent.mjs';
import * as sina from './providers/sina.mjs';

const SOURCE_TIMEOUT_MS = 5000;
const BUDGET_MS = 20000;

/**
 * 历史日（tradeDate < today）的 quote 必须 point-in-time：用当日日 K 收盘派生，
 * 不能用实时行情（其 asOf 会晚于 tradeDate，按 §5 属于未来数据）。
 * @param {any} klinesResult
 * @param {{ symbol: string, tradeDate: string }} context
 */
export function deriveHistoricalQuote(klinesResult, { symbol, tradeDate }) {
  const source = klinesResult.status === 'missing' ? null : `klines:${klinesResult.source}`;
  const attempts = source
    ? [{ source, ok: true, ms: 0 }]
    : [{ source: 'klines-derived', ok: false, ms: 0, error: { code: CODES.EMPTY, message: '历史日 quote 派生失败：当日 K 线缺失' } }];
  if (klinesResult.status === 'missing') {
    return {
      status: 'missing', source: null, fetchedAt: null, asOf: null, data: null, attempts, warnings: [],
    };
  }
  const bars = klinesResult.data.bars;
  const index = bars.findIndex((bar) => bar.date === tradeDate);
  if (index < 0) {
    return {
      status: 'missing',
      source,
      fetchedAt: klinesResult.fetchedAt,
      asOf: null,
      data: null,
      attempts: [{ source, ok: false, ms: 0, error: { code: CODES.EMPTY, message: `${tradeDate} 当日无 K 线（停牌/非交易日）` } }],
      warnings: [],
    };
  }
  const bar = bars[index];
  const prevClose = index > 0 ? bars[index - 1].close : null;
  const change = prevClose === null ? null : Number((bar.close - prevClose).toFixed(4));
  const changePct = prevClose === null || prevClose === 0 ? null : Number((((bar.close - prevClose) / prevClose) * 100).toFixed(4));
  return {
    status: 'ok',
    source,
    fetchedAt: klinesResult.fetchedAt,
    asOf: `${tradeDate}T15:00:00+08:00`,
    data: {
      symbol,
      name: null,
      exchange: null,
      price: bar.close,
      prevClose,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volumeShares: bar.volumeShares,
      amount: bar.amount,
      change,
      changePct,
      asOf: `${tradeDate}T15:00:00+08:00`,
    },
    attempts,
    warnings: ['历史日 quote 由当日日 K 收盘派生（point-in-time）'],
  };
}

/**
 * 当日 quote 的时效体检：行情时间早于 tradeDate、成交量为 0 → 标 degraded（不静默当实时）。
 * @param {any} quoteResult
 * @param {string} tradeDate
 */
function applyQuoteFreshnessCheck(quoteResult, tradeDate) {
  if (quoteResult.status === 'missing' || !quoteResult.data) return quoteResult;
  const warnings = [...quoteResult.warnings];
  const asOfDate = typeof quoteResult.data.asOf === 'string' ? quoteResult.data.asOf.slice(0, 10) : null;
  if (asOfDate !== null && asOfDate !== tradeDate) {
    warnings.push(`行情时间 ${quoteResult.data.asOf} 早于 tradeDate ${tradeDate}（非实时/停牌/未开盘）`);
  }
  if (quoteResult.data.volumeShares === 0) {
    warnings.push('当日成交量为 0（停牌或未开盘）');
  }
  if (warnings.length > quoteResult.warnings.length) {
    return { ...quoteResult, status: 'degraded', warnings };
  }
  return quoteResult;
}

/**
 * 降级链（D13）。未实现的类别保留空链：请求时记 `missing` + `UNSUPPORTED`，绝不用近似字段冒充。
 * @type {Record<string, Array<{ source: string, fetch: (ctx: any) => Promise<any> }>>}
 */
export const CATEGORY_CHAINS = {
  quote: [
    { source: 'eastmoney', fetch: eastmoney.fetchQuote },
    { source: 'tencent', fetch: tencent.fetchQuote },
    { source: 'sina', fetch: sina.fetchQuote },
  ],
  klines: [
    { source: 'eastmoney', fetch: eastmoney.fetchKlines },
    { source: 'tencent', fetch: tencent.fetchKlines },
  ],
  fundamentals: [
    // shortcut: v1 只有东财（估值 + 主要财务指标）；新浪降级未实现，升级时补链。
    { source: 'eastmoney', fetch: eastmoney.fetchFundamentals },
  ],
  news: [
    // shortcut: 东财新闻搜索 + 公告合并；新浪降级未实现。
    { source: 'eastmoney', fetch: eastmoney.fetchNews },
  ],
  moneyflow: [
    // shortcut: 东财日级资金流；腾讯/新浪降级未实现。
    { source: 'eastmoney', fetch: eastmoney.fetchMoneyflow },
  ],
  // 以下类别尚未实现（增量交付，见 design/data-layer.md §12）。
  dragon_tiger: [],
  sector: [],
};

export const CATEGORY_KEYS = Object.freeze(Object.keys(CATEGORY_CHAINS));

/** @param {AbortSignal|undefined} parent @param {number} timeoutMs */
function attemptSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/**
 * @param {string} category
 * @param {{ symbol: string, tradeDate: string, signal?: AbortSignal }} context
 * @param {{ deadline: number, timeoutMs: number, snapshotAt: string }} runtime
 */
async function fetchCategory(category, context, runtime) {
  const chain = CATEGORY_CHAINS[category] ?? [];
  /** @type {Array<{ source: string, ok: boolean, ms: number, error?: { code: string, message: string } }>} */
  const attempts = [];

  if (chain.length === 0) {
    return {
      status: 'missing',
      source: null,
      fetchedAt: null,
      asOf: null,
      data: null,
      attempts: [{
        source: '(none)',
        ok: false,
        ms: 0,
        error: { code: CODES.UNSUPPORTED, message: `类别 ${category} 尚未实现（增量交付）` },
      }],
      warnings: [],
    };
  }

  for (const provider of chain) {
    if (Date.now() > runtime.deadline) {
      attempts.push({
        source: provider.source,
        ok: false,
        ms: 0,
        error: { code: CODES.BUDGET_EXCEEDED, message: '总抓取预算耗尽' },
      });
      break;
    }
    const started = Date.now();
    try {
      const result = await provider.fetch({
        symbol: context.symbol,
        tradeDate: context.tradeDate,
        signal: attemptSignal(context.signal, runtime.timeoutMs),
        isHistorical: context.isHistorical,
      });
      attempts.push({ source: provider.source, ok: true, ms: Date.now() - started });
      return {
        status: result.degraded?.length ? 'degraded' : 'ok',
        source: provider.source,
        fetchedAt: runtime.snapshotAt,
        asOf: result.asOf ?? null,
        data: result.data,
        attempts,
        warnings: result.degraded?.length ? result.degraded : (result.warnings ?? []),
      };
    } catch (error) {
      attempts.push({
        source: provider.source,
        ok: false,
        ms: Date.now() - started,
        error: toAttemptError(error),
      });
    }
  }

  return {
    status: 'missing',
    source: null,
    fetchedAt: null,
    asOf: null,
    data: null,
    attempts,
    warnings: [],
  };
}

/**
 * 取一次分析所需的数据快照。
 *
 * @param {{
 *   symbol: string,
 *   tradeDate?: string,
 *   categories?: string[],
 *   signal?: AbortSignal,
 *   now?: Date,
 *   timeoutMs?: number,
 *   budgetMs?: number,
 * }} options
 * @returns {Promise<{
 *   symbol: string, exchange: string, tradeDate: string, snapshotAt: string,
 *   categories: Record<string, any>, missing: string[],
 *   fatal?: { category: 'quote', reason: { code: string, message: string } },
 * }>}
 */
export async function fetchSnapshot({
  symbol,
  tradeDate,
  // shortcut: 默认只取已实现类别；未实现类别需显式请求（返回 missing + UNSUPPORTED）。
  categories = ['quote', 'klines', 'fundamentals', 'news', 'moneyflow'],
  signal,
  now = new Date(),
  timeoutMs = SOURCE_TIMEOUT_MS,
  budgetMs = BUDGET_MS,
}) {
  const parsed = parseSymbol(symbol);
  const date = tradeDate ?? todayShanghai(now);
  await assertTradingDay(date, { signal, now, timeoutMs });
  // 注意：日历校验可能耗时数秒，预算从校验之后算，避免把日历时间算进数据预算。
  const runtime = {
    deadline: Date.now() + budgetMs,
    timeoutMs,
    snapshotAt: nowIsoShanghai(new Date()),
  };

  const requested = Array.from(new Set(categories));
  /** @type {Record<string, any>} */
  const results = {};
  const isHistorical = date < todayShanghai(now);
  const context = { symbol: parsed.symbol, tradeDate: date, signal, isHistorical };
  const needsDerivedQuote = requested.includes('quote') && isHistorical;

  // 历史日：quote 由当日 K 线派生，必须先取 K 线（即使 klines 未被显式请求）。
  if (needsDerivedQuote) {
    results.klines = await fetchCategory('klines', context, runtime);
  }

  await Promise.all(requested.map(async (category) => {
    if (needsDerivedQuote && category === 'klines') return; // 已取
    if (needsDerivedQuote && category === 'quote') {
      results.quote = deriveHistoricalQuote(results.klines, context);
      return;
    }
    results[category] = await fetchCategory(category, context, runtime);
    if (category === 'quote') {
      results.quote = applyQuoteFreshnessCheck(results.quote, date);
    }
  }));
  if (!requested.includes('klines') && needsDerivedQuote) {
    // 派生用的 K 线不出现在快照里，除非调用方显式请求。
    delete results.klines;
  }

  /** @type {string[]} */
  const missing = requested.filter((category) => results[category].status !== 'ok');

  /** @type {{ category: 'quote', reason: { code: string, message: string } } | undefined} */
  let fatal;
  if (requested.includes('quote') && results.quote.status === 'missing') {
    const lastAttempt = [...results.quote.attempts].reverse().find((attempt) => !attempt.ok);
    fatal = {
      category: 'quote',
      reason: lastAttempt?.error ?? { code: CODES.EMPTY, message: '行情不可用' },
    };
  }

  return {
    symbol: parsed.symbol,
    exchange: parsed.exchange,
    tradeDate: date,
    snapshotAt: runtime.snapshotAt,
    categories: results,
    missing,
    ...(fatal ? { fatal } : {}),
  };
}

export { CODES, InputRejectedError } from './errors.mjs';

/**
 * Latest quote only (no trading-day validation): used by the paper account and
 * watchlist, which may legitimately request prices on a non-trading day.
 * Returns a result object instead of throwing so callers can show the chain.
 *
 * @param {{ symbol: string, signal?: AbortSignal, timeoutMs?: number, budgetMs?: number }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   quote?: any, source?: string, asOf?: string|null, warnings?: string[],
 *   attempts: Array<{ source: string, ok: boolean, ms: number, error?: { code: string, message: string } }>,
 *   error?: { code: string, message: string },
 * }>}
 */
export async function fetchLatestQuote({ symbol, signal, timeoutMs = SOURCE_TIMEOUT_MS, budgetMs = BUDGET_MS } = {}) {
  const parsed = parseSymbol(symbol);
  const deadline = Date.now() + budgetMs;
  const attempts = [];
  for (const provider of CATEGORY_CHAINS.quote) {
    if (Date.now() > deadline) {
      attempts.push({ source: provider.source, ok: false, ms: 0, error: { code: CODES.BUDGET_EXCEEDED, message: '总抓取预算耗尽' } });
      break;
    }
    const started = Date.now();
    try {
      const result = await provider.fetch({ symbol: parsed.symbol, signal: attemptSignal(signal, timeoutMs) });
      attempts.push({ source: provider.source, ok: true, ms: Date.now() - started });
      return {
        ok: true,
        quote: result.data,
        source: provider.source,
        asOf: result.asOf ?? result.data?.asOf ?? null,
        warnings: result.degraded?.length ? result.degraded : (result.warnings ?? []),
        attempts,
      };
    } catch (error) {
      attempts.push({ source: provider.source, ok: false, ms: Date.now() - started, error: toAttemptError(error) });
    }
  }
  const last = [...attempts].reverse().find((attempt) => !attempt.ok);
  return { ok: false, attempts, error: last?.error ?? { code: CODES.EMPTY, message: '行情不可用' } };
}
