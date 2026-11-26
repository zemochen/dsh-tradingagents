/**
 * 新浪 provider：行情快照（第三级降级源）。
 *
 * 2026-11-17 实测（fixture 见 `src/data/fixtures/`）：
 * `hq.sinajs.cn/list=sh600519`（需 `Referer: https://finance.sina.com.cn`），GBK 文本，
 * `var hq_str_sh600519="..."`，`,` 分隔：
 * 0 名称、1 今开、2 昨收、3 现价、4 最高、5 最低、6 买一、7 卖一、
 * 8 成交量(股)、9 成交额(元)、…、30 日期(YYYY-MM-DD)、31 时间(HH:mm:ss)。
 */
import { CODES, ProviderError } from '../errors.mjs';
import {
  isoFromDateTime, num, parseSymbol,
} from '../normalize.mjs';

const SOURCE = 'sina';
const QUOTE_URL = 'https://hq.sinajs.cn/list=';
const REFERER = 'https://finance.sina.com.cn';

/**
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 */
async function getText(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: REFERER,
      },
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
 * 纯解析：新浪 GBK 文本 → 归一化 Quote。
 * @param {string} text
 * @returns {import('./eastmoney.mjs').Quote}
 */
export function parseQuote(text) {
  const match = /hq_str_(?:sh|sz|bj)(\d{6})="([^"]*)"/.exec(String(text ?? ''));
  if (!match) {
    throw new ProviderError(CODES.PARSE_ERROR, '新浪行情响应格式不匹配（未找到 hq_str_<code>="..."）', { source: SOURCE });
  }
  const raw = match[2];
  if (raw === '') {
    throw new ProviderError(CODES.EMPTY, '新浪返回空行情（代码不存在或已退市）', { source: SOURCE });
  }
  const fields = raw.split(',');
  if (fields.length < 32) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, `新浪行情字段数异常：${fields.length}`, { source: SOURCE });
  }
  const price = num(fields[3]);
  if (price === null || price <= 0) {
    throw new ProviderError(CODES.EMPTY, '现价为空或为 0（停牌/未开盘/源无数据）', { source: SOURCE });
  }
  return {
    symbol: match[1],
    name: fields[0] || null,
    exchange: null,
    price,
    prevClose: num(fields[2]),
    open: num(fields[1]),
    high: num(fields[4]),
    low: num(fields[5]),
    volumeShares: num(fields[8]),
    amount: num(fields[9]),
    change: price !== null && num(fields[2]) !== null ? Number((price - num(fields[2])).toFixed(4)) : null,
    changePct: price !== null && num(fields[2]) !== null && num(fields[2]) > 0
      ? Number((((price - num(fields[2])) / num(fields[2])) * 100).toFixed(4))
      : null,
    asOf: isoFromDateTime(fields[30], fields[31]),
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
