/**
 * 数据层错误类型与错误码。
 *
 * 两类错误：
 * - ProviderError：某个数据源获取/解析失败。被 fetchSnapshot 捕获后写入 attempts，并进入下一源。
 * - InputRejectedError：输入校验失败（代码非法 / 未来日期 / 非交易日 / 日历不可用）。
 *   不写进 `missing`、不产出报告——由 UI 提示用户重选或修正。
 */

/** @typedef {'SOURCE_TIMEOUT'|'SOURCE_HTTP'|'RATE_LIMIT'|'PARSE_ERROR'|'SCHEMA_DRIFT'|'EMPTY'|'BUDGET_EXCEEDED'|'UNSUPPORTED'|'NON_TRADING_DAY'|'FUTURE_DATE'|'CALENDAR_UNAVAILABLE'|'INVALID_SYMBOL'} ErrorCode */

export const CODES = /** @type {const} */ ({
  SOURCE_TIMEOUT: 'SOURCE_TIMEOUT',
  SOURCE_HTTP: 'SOURCE_HTTP',
  RATE_LIMIT: 'RATE_LIMIT',
  PARSE_ERROR: 'PARSE_ERROR',
  SCHEMA_DRIFT: 'SCHEMA_DRIFT',
  EMPTY: 'EMPTY',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  UNSUPPORTED: 'UNSUPPORTED',
  NON_TRADING_DAY: 'NON_TRADING_DAY',
  FUTURE_DATE: 'FUTURE_DATE',
  CALENDAR_UNAVAILABLE: 'CALENDAR_UNAVAILABLE',
  INVALID_SYMBOL: 'INVALID_SYMBOL',
});

export class ProviderError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{ source?: string, status?: number, cause?: unknown }} [options]
   */
  constructor(code, message, { source, status, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.source = source;
    this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

export class InputRejectedError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{ field?: string, value?: string }} [options]
   */
  constructor(code, message, { field, value } = {}) {
    super(message);
    this.name = 'InputRejectedError';
    this.code = code;
    this.field = field;
    this.value = value;
  }
}

/**
 * 把错误压成 attempts 里的可序列化记录。不包含响应全文、URL query 或凭据。
 * @param {unknown} error
 * @returns {{ code: ErrorCode, message: string }}
 */
export function toAttemptError(error) {
  if (error instanceof ProviderError || error instanceof InputRejectedError) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'PARSE_ERROR', message };
}
