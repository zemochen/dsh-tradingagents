/**
 * 交易日校验（2026-11-17 用户拍板：非交易日 → 提示重选，不回退最近交易日）。
 *
 * 判断方式（2026-11-17 实测）：取上证指数单日日 K——
 * - 东财：`beg=end=<tradeDate>`，有 1 根即交易日，`klines: []` 即非交易日；
 * - 腾讯（降级）：`sh000001` 单日区间，`day` 数组非空即交易日。
 *
 * 两个源都不可用 → `CALENDAR_UNAVAILABLE`（不猜、不回退）；都可用且均为空 → `NON_TRADING_DAY`。
 */
import { CODES, InputRejectedError, toAttemptError } from './errors.mjs';
import { assertTradeDate } from './normalize.mjs';
import { fetchIndexDay as eastmoneyIndexDay } from './providers/eastmoney.mjs';
import { fetchIndexDay as tencentIndexDay } from './providers/tencent.mjs';

const CALENDAR_SOURCES = [
  { source: 'eastmoney', fetch: eastmoneyIndexDay },
  { source: 'tencent', fetch: tencentIndexDay },
];

/** @param {AbortSignal|undefined} parent @param {number} timeoutMs */
function attemptSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/**
 * @typedef {{ source: string, ok: boolean, ms: number, error?: { code: string, message: string } }} CalendarAttempt
 */

/**
 * 校验 `tradeDate` 是交易日；否则抛 `InputRejectedError`（NON_TRADING_DAY / FUTURE_DATE / CALENDAR_UNAVAILABLE）。
 *
 * @param {string} tradeDate
 * @param {{ signal?: AbortSignal, now?: Date, timeoutMs?: number }} [options]
 * @returns {Promise<{ tradeDate: string, source: string, attempts: CalendarAttempt[] }>}
 */
export async function assertTradingDay(tradeDate, { signal, now, timeoutMs = 5000 } = {}) {
  const date = assertTradeDate(tradeDate, { now });

  /** @type {CalendarAttempt[]} */
  const attempts = [];
  let answeredBy = null;

  for (const calendarSource of CALENDAR_SOURCES) {
    const started = Date.now();
    try {
      const result = await calendarSource.fetch({
        tradeDate: date,
        signal: attemptSignal(signal, timeoutMs),
      });
      attempts.push({ source: calendarSource.source, ok: true, ms: Date.now() - started });
      if (result.trading) {
        return { tradeDate: date, source: calendarSource.source, attempts };
      }
      answeredBy = calendarSource.source;
    } catch (error) {
      attempts.push({
        source: calendarSource.source,
        ok: false,
        ms: Date.now() - started,
        error: toAttemptError(error),
      });
    }
  }

  if (answeredBy === null) {
    throw new InputRejectedError(
      CODES.CALENDAR_UNAVAILABLE,
      `无法校验 ${date} 是否为交易日：东财 / 腾讯日历源均不可用，请稍后重试`,
      { field: 'tradeDate', value: date },
    );
  }

  const rejected = new InputRejectedError(
    CODES.NON_TRADING_DAY,
    `${date} 不是交易日，请重新选择交易日`,
    { field: 'tradeDate', value: date },
  );
  // 把日历尝试记录挂到错误上，供日志/UI 展示（不是数据缺口，不进 missing）。
  Object.defineProperty(rejected, 'attempts', { value: attempts, enumerable: true });
  throw rejected;
}
