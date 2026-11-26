/**
 * 腾讯 provider：行情快照、日 K、指数单日 K（交易日校验降级源）。
 *
 * 2026-11-17 实测（fixture 见 `src/data/fixtures/`）：
 * - 行情 `qt.gtimg.cn/q=sh600519`：GBK 文本，`v_sh600519="..."`，`~` 分隔；
 *   第 3 现价、4 昨收、5 今开、6 成交量(手)、30 时间(YYYYMMDDHHmmss)、31 涨跌额、32 涨跌幅、
 *   33 最高、34 最低、35 `价/量(手)/额(元)`、37 成交额(万元)。
 * - 日 K `web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,<start>,<end>,<count>,qfq`：
 *   `data.sh600519.qfqday`（前复权）或 `.day`（不复权），数组为
 *   `[日期, 开, 收, 高, 低, 量(手)]`；**不含成交额**。
 * - 指数：param `sh000001,day,<start>,<end>,<count>,qfq`，返回 `.day`，用于交易日校验。
 */
import { CODES, ProviderError } from '../errors.mjs';
import {
  isoFromCompactStamp, lotsToShares, num, parseSymbol,
} from '../normalize.mjs';

const SOURCE = 'tencent';
const QUOTE_URL = 'https://qt.gtimg.cn/q=';
const KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

/**
 * 腾讯行情是 GBK；用 TextDecoder('gbk') 解码（Node 自带 full-icu，2026-11-17 实测）。
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 */
async function getText(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.qq.com/' },
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    throw new ProviderError(
      isAbort ? CODES.SOURCE_TIMEOUT : CODES.SOURCE_HTTP,
      isAbort ? '请求超时或被取消' : `网络错误：${error instanceof Error ? error.message : String(error)}`,
      { source: SOURCE, cause: error },
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      response.status === 429 ? CODES.RATE_LIMIT : CODES.SOURCE_HTTP,
      `HTTP ${response.status}`,
      { source: SOURCE, status: response.status },
    );
  }
  try {
    const buffer = await response.arrayBuffer();
    return new TextDecoder('gbk').decode(buffer);
  } catch (error) {
    throw new ProviderError(CODES.PARSE_ERROR, 'GBK 解码失败', { source: SOURCE, cause: error });
  }
}

/**
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 */
async function getJson(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.qq.com/' },
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    throw new ProviderError(
      isAbort ? CODES.SOURCE_TIMEOUT : CODES.SOURCE_HTTP,
      isAbort ? '请求超时或被取消' : `网络错误：${error instanceof Error ? error.message : String(error)}`,
      { source: SOURCE, cause: error },
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      response.status === 429 ? CODES.RATE_LIMIT : CODES.SOURCE_HTTP,
      `HTTP ${response.status}`,
      { source: SOURCE, status: response.status },
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ProviderError(CODES.PARSE_ERROR, '响应不是合法 JSON', { source: SOURCE, cause: error });
  }
}

/**
 * 纯解析：腾讯 GBK 文本 → 归一化 Quote。
 * @param {string} text
 * @returns {import('./eastmoney.mjs').Quote}
 */
export function parseQuote(text) {
  const match = /v_(?:sh|sz|bj)(\d{6})="([^"]*)"/.exec(String(text ?? ''));
  if (!match) {
    throw new ProviderError(CODES.PARSE_ERROR, '腾讯行情响应格式不匹配（未找到 v_<code>="..."）', { source: SOURCE });
  }
  const fields = match[2].split('~');
  if (fields.length < 40) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, `腾讯行情字段数异常：${fields.length}`, { source: SOURCE });
  }
  const price = num(fields[3]);
  if (price === null || price <= 0) {
    throw new ProviderError(CODES.EMPTY, '现价为空或为 0（停牌/未开盘/源无数据）', { source: SOURCE });
  }
  // 第 35 字段是 `价/量(手)/额(元)`，其中的成交额是精确到元的原始值。
  const composite = fields[35].split('/');
  const amountFromComposite = composite.length === 3 ? num(composite[2]) : null;
  const amountFromLots = num(fields[37]) === null ? null : num(fields[37]) * 10000;
  return {
    symbol: match[1],
    name: fields[1] || null,
    exchange: null,
    price,
    prevClose: num(fields[4]),
    open: num(fields[5]),
    high: num(fields[33]),
    low: num(fields[34]),
    volumeShares: lotsToShares(fields[6]),
    amount: amountFromComposite ?? amountFromLots,
    change: num(fields[31]),
    changePct: num(fields[32]),
    asOf: isoFromCompactStamp(fields[30]),
  };
}

/**
 * @param {{ symbol: string, signal?: AbortSignal }} options
 * @returns {Promise<import('./eastmoney.mjs').Quote>}
 */
export async function fetchQuote({ symbol, signal }) {
  const parsed = parseSymbol(symbol);
  const text = await getText(`${QUOTE_URL}${parsed.prefix}${parsed.symbol}`, { signal });
  const quote = parseQuote(text);
  quote.exchange = parsed.exchange;
  return { data: quote, asOf: quote.asOf, warnings: [], degraded: [] };
}

/**
 * @typedef {import('./eastmoney.mjs').KlineBar} KlineBar
 */

/**
 * 纯解析：腾讯日 K JSON → bars（升序）。
 * @param {any} body
 * @param {string} symbol
 * @returns {{ bars: KlineBar[], adjusted: boolean, warnings: string[] }}
 */
export function parseKlines(body, symbol) {
  const data = body?.data;
  const code = String(symbol ?? '').trim();
  const keyCandidates = Object.keys(data ?? {}).filter((key) => key.endsWith(code));
  if (keyCandidates.length === 0) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, `腾讯 K 线响应缺少 data.*${code}`, { source: SOURCE });
  }
  const entry = data[keyCandidates[0]];
  const qfqday = entry?.qfqday;
  const day = entry?.day;
  const rows = Array.isArray(qfqday) ? qfqday : day;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '腾讯 K 线响应缺少 day/qfqday 数组', { source: SOURCE });
  }
  if (rows.length === 0) {
    throw new ProviderError(CODES.EMPTY, 'K 线为空', { source: SOURCE });
  }
  const adjusted = Array.isArray(qfqday);
  const bars = rows.map((row) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new ProviderError(CODES.SCHEMA_DRIFT, `腾讯 K 线行字段不足：${JSON.stringify(row).slice(0, 60)}`, { source: SOURCE });
    }
    return {
      date: String(row[0]),
      open: num(row[1]),
      close: num(row[2]),
      high: num(row[3]),
      low: num(row[4]),
      volumeShares: lotsToShares(row[5]),
      amount: null,
      changePct: null,
      turnoverPct: null,
    };
  });
  const warnings = [adjusted ? '腾讯日 K 为前复权（qfq）' : '腾讯日 K 为不复权（day）', '腾讯日 K 不含成交额/涨跌幅'];
  return { bars, adjusted, warnings };
}

/**
 * @param {{ symbol: string, tradeDate: string, days?: number, signal?: AbortSignal }} options
 * @returns {Promise<{ bars: KlineBar[], adjusted: boolean, warnings: string[], requestedDays: number }>}
 */
export async function fetchKlines({ symbol, tradeDate, days = 120, signal }) {
  const parsed = parseSymbol(symbol);
  const url = `${KLINE_URL}?param=${parsed.prefix}${parsed.symbol},day,,${tradeDate},${Math.max(days, 320)},qfq`;
  const body = await getJson(url, { signal });
  const parsedKlines = parseKlines(body, parsed.symbol);
  const bars = parsedKlines.bars.filter((bar) => bar.date <= tradeDate).slice(-days);
  if (bars.length === 0) {
    throw new ProviderError(CODES.EMPTY, `tradeDate ${tradeDate} 之前没有 K 线`, { source: SOURCE });
  }
  return {
    data: { bars, adjusted: parsedKlines.adjusted },
    asOf: bars[bars.length - 1]?.date ?? null,
    warnings: parsedKlines.warnings,
    degraded: ['腾讯日 K 不含成交额/涨跌幅'],
  };
}

/**
 * 单日指数日 K：用于交易日校验的降级源。返回当日是否有 K 线。
 * @param {{ tradeDate: string, signal?: AbortSignal }} options
 * @returns {Promise<{ trading: boolean, date: string }>}
 */
export function parseIndexDay(body, tradeDate) {
  const entry = body?.data?.sh000001;
  const rows = entry?.day ?? entry?.qfqday;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '腾讯指数 K 线响应缺少 day 数组', { source: SOURCE });
  }
  return { trading: rows.some((row) => Array.isArray(row) && String(row[0]) === tradeDate), date: tradeDate };
}

export async function fetchIndexDay({ tradeDate, signal }) {
  const url = `${KLINE_URL}?param=sh000001,day,${tradeDate},${tradeDate},10,qfq`;
  const body = await getJson(url, { signal });
  return parseIndexDay(body, tradeDate);
}
