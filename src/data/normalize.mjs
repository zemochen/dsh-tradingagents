/**
 * 归一化纯函数：A 股代码 → 交易所映射、单位换算、时间 ISO 化、数值清洗。
 * 这些函数不做 I/O，便于用真实响应 fixture 单测。
 */
import { CODES, InputRejectedError } from './errors.mjs';

// A 股代码前缀（2026-11-17 按沪/深/北现状整理；B 股 900/200 段不属于本期范围，显式拒绝）
const SH_PREFIXES = ['600', '601', '603', '605', '688', '689'];
const SZ_PREFIXES = ['000', '001', '002', '003', '300', '301'];
const BJ_PREFIXES = [
  '430', '830', '831', '832', '833', '834', '835', '836', '837', '838', '839',
  '870', '871', '872', '873', '920',
];

/**
 * @param {string} raw
 * @returns {{ symbol: string, exchange: 'sh'|'sz'|'bj', prefix: 'sh'|'sz'|'bj', secid: string }}
 */
export function parseSymbol(raw) {
  const symbol = String(raw ?? '').trim();
  if (!/^\d{6}$/.test(symbol)) {
    throw new InputRejectedError(
      CODES.INVALID_SYMBOL,
      '股票代码必须是 6 位数字',
      { field: 'symbol', value: String(raw ?? '') },
    );
  }
  const head = symbol.slice(0, 3);
  /** @type {'sh'|'sz'|'bj'|null} */
  let exchange = null;
  if (SH_PREFIXES.includes(head)) exchange = 'sh';
  else if (SZ_PREFIXES.includes(head)) exchange = 'sz';
  else if (BJ_PREFIXES.includes(head)) exchange = 'bj';

  if (exchange === null) {
    throw new InputRejectedError(
      CODES.INVALID_SYMBOL,
      `无法识别交易所：${symbol}（本期仅支持沪 / 深 / 北 A 股）`,
      { field: 'symbol', value: symbol },
    );
  }
  return {
    symbol,
    exchange,
    prefix: exchange,
    // 东财 secid：沪市 market=1；深市/北交所 market=0（2026-11-17 实测：1.600519 / 0.000001 / 0.830799）
    secid: `${exchange === 'sh' ? '1' : '0'}.${symbol}`,
  };
}

/**
 * 清洗数值：`'-'`、空串、`null` 一律为 null，不用 0 冒充缺失。
 * @param {unknown} value
 * @returns {number|null}
 */
export function num(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === '' || text === '-' || text === '--' || text === 'null' || text === 'undefined') return null;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 定点缩放（东财返回的整数价格多为 ×100）。
 * @param {unknown} value
 * @param {number} divisor
 * @returns {number|null}
 */
export function scaled(value, divisor) {
  const parsed = num(value);
  return parsed === null ? null : parsed / divisor;
}

/**
 * 手 → 股（东财 f47、腾讯行情第 6 字段以「手」计）。
 * @param {unknown} lots
 * @returns {number|null}
 */
export function lotsToShares(lots) {
  const parsed = num(lots);
  return parsed === null ? null : Math.round(parsed * 100);
}

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

/**
 * 取某个时刻在 Asia/Shanghai 的日期/时间分量。
 * @param {Date} date
 */
function shanghaiParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  /** @type {Record<string,string>} */
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

/**
 * @param {Date} [now]
 * @returns {string} `YYYY-MM-DD`（Asia/Shanghai）
 */
export function todayShanghai(now = new Date()) {
  const p = shanghaiParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * 当前时刻 ISO8601（+08:00），用于 snapshotAt / fetchedAt。
 * @param {Date} [now]
 * @returns {string}
 */
export function nowIsoShanghai(now = new Date()) {
  const p = shanghaiParts(now);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/**
 * Unix 秒 → ISO8601（+08:00）。用于东财 f86。
 * @param {unknown} seconds
 * @returns {string|null}
 */
export function isoFromEpochSeconds(seconds) {
  const parsed = num(seconds);
  if (parsed === null) return null;
  const p = shanghaiParts(new Date(parsed * 1000));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/**
 * `YYYYMMDDHHmmss` → ISO8601（+08:00）。用于腾讯行情第 30 字段。
 * @param {unknown} stamp
 * @returns {string|null}
 */
export function isoFromCompactStamp(stamp) {
  const text = String(stamp ?? '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
}

/**
 * 日期 + 时间 → ISO8601（+08:00）。用于新浪行情。
 * @param {string} date `YYYY-MM-DD`
 * @param {string} time `HH:mm:ss`
 * @returns {string|null}
 */
export function isoFromDateTime(date, time) {
  const d = String(date ?? '').trim();
  const t = String(time ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(t)) return `${d}T00:00:00+08:00`;
  return `${d}T${t}+08:00`;
}

/**
 * `YYYY-MM-DD` 加减天数（按 UTC 计算，避免时区导致的日期漂移）。
 * @param {string} date
 * @param {number} deltaDays
 * @returns {string}
 */
export function addDays(date, deltaDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  if (!m) throw new InputRejectedError(CODES.FUTURE_DATE, `日期格式非法：${date}`, { field: 'tradeDate', value: String(date) });
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const shifted = new Date(base + deltaDays * 86400000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` → `YYYYMMDD`（东财 beg/end 参数）。
 * @param {string} date
 * @returns {string}
 */
export function compactDate(date) {
  return String(date).replace(/-/g, '');
}

/**
 * 校验 `tradeDate` 形状，并确认不是未来日期。
 * @param {string} tradeDate
 * @param {{ now?: Date }} [options]
 * @returns {string} 规范化后的 `YYYY-MM-DD`
 */
export function assertTradeDate(tradeDate, { now = new Date() } = {}) {
  const text = String(tradeDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new InputRejectedError(CODES.FUTURE_DATE, `交易日格式非法：${tradeDate}（应为 YYYY-MM-DD）`, {
      field: 'tradeDate',
      value: String(tradeDate ?? ''),
    });
  }
  const today = todayShanghai(now);
  if (text > today) {
    throw new InputRejectedError(CODES.FUTURE_DATE, `${text} 晚于今天（${today}），不能分析未来日期`, {
      field: 'tradeDate',
      value: text,
    });
  }
  return text;
}
