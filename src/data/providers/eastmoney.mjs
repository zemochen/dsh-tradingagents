/**
 * 东方财富 provider：行情快照、日 K、指数单日 K（供交易日校验）。
 *
 * 2026-11-17 实测的接口与字段（fixture 见 `src/data/fixtures/`）：
 * - 行情 `push2.eastmoney.com/api/qt/stock/get`：f43 现价×100、f44 最高×100、f45 最低×100、
 *   f46 今开×100、f47 成交量(手)、f48 成交额(元)、f57 代码、f58 名称、f60 昨收×100、
 *   f86 时间(unix 秒)、f169 涨跌额×100、f170 涨跌幅×100。
 * - 日 K `push2his.eastmoney.com/api/qt/stock/kline/get`：fields2 顺序
 *   f51 日期, f52 开, f53 收, f54 高, f55 低, f56 量(手), f57 额(元), f58 振幅%, f59 涨跌幅%, f60 涨跌额, f61 换手%。
 */
import { CODES, ProviderError } from '../errors.mjs';
import {
  compactDate, addDays, isoFromEpochSeconds, lotsToShares, num, parseSymbol, scaled,
} from '../normalize.mjs';

const SOURCE = 'eastmoney';
const QUOTE_URL = 'https://push2.eastmoney.com/api/qt/stock/get';
const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const UT = 'fa5fd1943c7b386f172d6893dbfba10b';
const QUOTE_FIELDS = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f169,f170';
const KLINE_FIELDS_1 = 'f1,f2,f3,f4,f5,f6';
const KLINE_FIELDS_2 = 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

/**
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 */
async function getJson(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
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
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
async function getText(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.eastmoney.com/' },
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
    return await response.text();
  } catch (error) {
    throw new ProviderError(CODES.PARSE_ERROR, '响应读取失败', { source: SOURCE, cause: error });
  }
}

/**
 * @typedef {object} Quote
 * @property {string} symbol
 * @property {string|null} name
 * @property {'sh'|'sz'|'bj'|null} exchange
 * @property {number|null} price
 * @property {number|null} prevClose
 * @property {number|null} open
 * @property {number|null} high
 * @property {number|null} low
 * @property {number|null} volumeShares
 * @property {number|null} amount
 * @property {number|null} change
 * @property {number|null} changePct
 * @property {string|null} asOf
 */

/**
 * 纯解析：东财行情 JSON → 归一化 Quote。
 * @param {any} body
 * @returns {Quote}
 */
export function parseQuote(body) {
  const data = body?.data;
  if (!data || data.f43 === undefined) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '行情响应缺少 data.f43（现价字段）', { source: SOURCE });
  }
  const price = scaled(data.f43, 100);
  if (price === null || price <= 0) {
    throw new ProviderError(CODES.EMPTY, '现价为空或为 0（停牌/未开盘/源无数据）', { source: SOURCE });
  }
  return {
    symbol: String(data.f57 ?? ''),
    name: data.f58 ?? null,
    exchange: null,
    price,
    prevClose: scaled(data.f60, 100),
    open: scaled(data.f46, 100),
    high: scaled(data.f44, 100),
    low: scaled(data.f45, 100),
    volumeShares: lotsToShares(data.f47),
    amount: num(data.f48),
    change: scaled(data.f169, 100),
    changePct: scaled(data.f170, 100),
    asOf: isoFromEpochSeconds(data.f86),
  };
}

/**
 * @param {{ symbol: string, signal?: AbortSignal }} options
 * @returns {Promise<Quote>}
 */
export async function fetchQuote({ symbol, signal }) {
  const parsed = parseSymbol(symbol);
  const url = `${QUOTE_URL}?secid=${parsed.secid}&fields=${QUOTE_FIELDS}&ut=${UT}`;
  const body = await getJson(url, { signal });
  const quote = parseQuote(body);
  quote.exchange = parsed.exchange;
  if (quote.symbol !== parsed.symbol) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, `响应代码 ${quote.symbol} 与请求 ${parsed.symbol} 不一致`, { source: SOURCE });
  }
  return { data: quote, asOf: quote.asOf, warnings: [], degraded: [] };
}

/**
 * @typedef {object} KlineBar
 * @property {string} date
 * @property {number|null} open
 * @property {number|null} close
 * @property {number|null} high
 * @property {number|null} low
 * @property {number|null} volumeShares
 * @property {number|null} amount
 * @property {number|null} changePct
 * @property {number|null} turnoverPct
 */

/**
 * 纯解析：东财日 K JSON → bars（按日期升序）。
 * @param {any} body
 * @returns {{ bars: KlineBar[], adjusted: boolean, warnings: string[] }}
 */
export function parseKlines(body) {
  const rows = body?.data?.klines;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, 'K 线响应缺少 data.klines 数组', { source: SOURCE });
  }
  if (rows.length === 0) {
    throw new ProviderError(CODES.EMPTY, 'K 线为空', { source: SOURCE });
  }
  const bars = rows.map((row) => {
    const f = String(row).split(',');
    if (f.length < 11) {
      throw new ProviderError(CODES.SCHEMA_DRIFT, `K 线行字段数异常（${f.length}）：${String(row).slice(0, 40)}`, { source: SOURCE });
    }
    return {
      date: f[0],
      open: num(f[1]),
      close: num(f[2]),
      high: num(f[3]),
      low: num(f[4]),
      volumeShares: lotsToShares(f[5]),
      amount: num(f[6]),
      changePct: num(f[8]),
      turnoverPct: num(f[10]),
    };
  });
  if (bars.some((bar) => bar.close === null)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, 'K 线存在空收盘价', { source: SOURCE });
  }
  return { bars, adjusted: true, warnings: ['使用前复权（fqt=1）'] };
}

/**
 * @param {{ symbol: string, tradeDate: string, days?: number, signal?: AbortSignal }} options
 * @returns {Promise<{ bars: KlineBar[], adjusted: boolean, warnings: string[], requestedDays: number }>}
 */
export async function fetchKlines({ symbol, tradeDate, days = 120, signal }) {
  const parsed = parseSymbol(symbol);
  // 多取 2 倍日历日，覆盖周末与节假日，再按 tradeDate 截断。
  const begin = addDays(tradeDate, -Math.ceil(days * 2.2));
  const url = `${KLINE_URL}?secid=${parsed.secid}&klt=101&fqt=1`
    + `&beg=${compactDate(begin)}&end=${compactDate(tradeDate)}`
    + `&fields1=${KLINE_FIELDS_1}&fields2=${KLINE_FIELDS_2}&ut=${UT}`;
  const body = await getJson(url, { signal });
  const parsedKlines = parseKlines(body);
  const bars = parsedKlines.bars.filter((bar) => bar.date <= tradeDate).slice(-days);
  if (bars.length === 0) {
    throw new ProviderError(CODES.EMPTY, `tradeDate ${tradeDate} 之前没有 K 线`, { source: SOURCE });
  }
  const warnings = parsedKlines.adjusted ? ['使用前复权（fqt=1）'] : [];
  return {
    data: { bars, adjusted: parsedKlines.adjusted },
    asOf: bars[bars.length - 1]?.date ?? null,
    warnings,
    degraded: [],
  };
}

/**
 * 单日指数日 K：用于交易日校验。返回当日是否有 K 线。
 * @param {{ tradeDate: string, signal?: AbortSignal }} options
 * @returns {Promise<{ trading: boolean, date: string }>}
 */
export function parseIndexDay(body, tradeDate) {
  const rows = body?.data?.klines;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '指数 K 线响应缺少 data.klines', { source: SOURCE });
  }
  return { trading: rows.some((row) => String(row).startsWith(tradeDate)), date: tradeDate };
}

export async function fetchIndexDay({ tradeDate, signal }) {
  const url = `${KLINE_URL}?secid=1.000001&klt=101&fqt=1`
    + `&beg=${compactDate(tradeDate)}&end=${compactDate(tradeDate)}`
    + `&fields1=${KLINE_FIELDS_1}&fields2=f51,f52&ut=${UT}`;
  const body = await getJson(url, { signal });
  return parseIndexDay(body, tradeDate);
}

// ---------------------------------------------------------------- fundamentals
/**
 * 基本面（v1 只有东财；新浪降级未实现）。
 * shortcut: 只有东财主源 + 财报只取「主要指标」，行业/估值来自行情接口；新浪降级待实现时再补链。
 *
 * 2026-11-17 实测：
 * - 行情估值字段：f116 总市值(元)、f117 流通市值(元)、f162 PE动×100、f163 PE静×100、
 *   f164 PE(TTM)×100、f167 PB×100、f127 行业、f128 板块。
 * - 财报指标 `datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA`：
 *   REPORT_DATE / REPORT_TYPE / NOTICE_DATE / TOTALOPERATEREVE(营收) / TOTALOPERATEREVETZ(营收同比%)
 *   / PARENTNETPROFIT(归母净利) / PARENTNETPROFITTZ(净利同比%) / ROEJQ(ROE%) / XSMLL(毛利率%)
 *   / ZCFZL(资产负债率%) / EPSJB / BPS / MGJYXJJE。与 `push2` 的 f183/f184/f105/f185/f173 交叉一致。
 */

const FINANCE_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const VALUATION_FIELDS = 'f57,f58,f43,f116,f117,f162,f163,f164,f167,f127,f128';

/**
 * 纯解析：估值字段 → 归一化 valuation。
 * @param {any} body
 */
export function parseValuation(body) {
  const data = body?.data;
  if (!data || data.f57 === undefined) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '估值响应缺少 data.f57', { source: SOURCE });
  }
  return {
    symbol: String(data.f57),
    name: data.f58 ?? null,
    price: scaled(data.f43, 100),
    marketCap: num(data.f116),
    floatMarketCap: num(data.f117),
    peDynamic: scaled(data.f162, 100),
    peStatic: scaled(data.f163, 100),
    peTtm: scaled(data.f164, 100),
    pb: scaled(data.f167, 100),
    industry: data.f127 ?? null,
    sector: data.f128 ?? null,
  };
}

/** @param {{ symbol: string, signal?: AbortSignal }} options */
export async function fetchValuation({ symbol, signal }) {
  const parsed = parseSymbol(symbol);
  const body = await getJson(`${QUOTE_URL}?secid=${parsed.secid}&fields=${VALUATION_FIELDS}&ut=${UT}`, { signal });
  return parseValuation(body);
}

/**
 * 纯解析：主要财务指标 → 最近一期「已披露且 reportDate 不晚于 tradeDate」的报告。
 * point-in-time 用 NOTICE_DATE（公告日）判断可得性，而不是 REPORT_DATE。
 * @param {any} body
 * @param {string} tradeDate
 */
export function parseFinancials(body, tradeDate) {
  const rows = body?.result?.data;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '财报响应缺少 result.data 数组', { source: SOURCE });
  }
  const eligible = rows
    .filter((row) => String(row.NOTICE_DATE ?? '').slice(0, 10) <= tradeDate)
    .sort((a, b) => String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)));
  if (eligible.length === 0) {
    throw new ProviderError(CODES.EMPTY, `tradeDate ${tradeDate} 之前没有已披露报告`, { source: SOURCE });
  }
  const row = eligible[0];
  return {
    reportDate: String(row.REPORT_DATE).slice(0, 10),
    reportType: row.REPORT_TYPE ?? null,
    noticeDate: String(row.NOTICE_DATE).slice(0, 10),
    revenue: num(row.TOTALOPERATEREVE),
    revenueYoY: num(row.TOTALOPERATEREVETZ),
    netProfit: num(row.PARENTNETPROFIT),
    netProfitYoY: num(row.PARENTNETPROFITTZ),
    roe: num(row.ROEJQ),
    grossMargin: num(row.XSMLL),
    debtRatio: num(row.ZCFZL),
    eps: num(row.EPSJB),
    bps: num(row.BPS),
    ocfPerShare: num(row.MGJYXJJE),
  };
}

/** @param {{ symbol: string, tradeDate: string, signal?: AbortSignal }} options */
export async function fetchFinancials({ symbol, tradeDate, signal }) {
  const parsed = parseSymbol(symbol);
  const params = new URLSearchParams({
    reportName: 'RPT_F10_FINANCE_MAINFINADATA',
    columns: 'ALL',
    filter: `(SECUCODE="${parsed.symbol}.${parsed.exchange.toUpperCase()}")`,
    pageNumber: '1',
    pageSize: '8',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    source: 'HSF10',
    client: 'PC',
  });
  const body = await getJson(`${FINANCE_URL}?${params.toString()}`, { signal });
  return parseFinancials(body, tradeDate);
}

/**
 * 基本面合并：估值 + 财报。任一子项缺失时另一个仍可用 → `degraded` 并说明缺哪块；两块都缺才失败。
 * 历史日（isHistorical）不取实时估值快照（PE/PB/市值是今天口径，属未来数据），只给财报。
 * @param {{ symbol: string, tradeDate: string, signal?: AbortSignal, isHistorical?: boolean }} options
 */
export async function fetchFundamentals({ symbol, tradeDate, signal, isHistorical = false }) {
  const [financialsResult, valuationResult] = await Promise.allSettled([
    fetchFinancials({ symbol, tradeDate, signal }),
    isHistorical ? Promise.resolve(null) : fetchValuation({ symbol, signal }),
  ]);

  const degraded = [];
  const data = { valuation: null, financials: null };

  if (isHistorical) degraded.push('历史日：估值快照非 point-in-time，已省略 PE/PB/市值');

  if (financialsResult.status === 'fulfilled') {
    data.financials = financialsResult.value;
  } else {
    const error = financialsResult.reason;
    degraded.push(`财报缺失：${error?.code ?? 'ERROR'} ${error?.message ?? ''}`.trim());
  }

  if (valuationResult.status === 'fulfilled' && valuationResult.value) {
    data.valuation = valuationResult.value;
  } else if (valuationResult.status === 'rejected') {
    const error = valuationResult.reason;
    degraded.push(`估值缺失：${error?.code ?? 'ERROR'} ${error?.message ?? ''}`.trim());
  }

  if (data.valuation === null && data.financials === null) {
    const error = financialsResult.reason;
    throw error instanceof ProviderError
      ? error
      : new ProviderError(CODES.SOURCE_HTTP, '基本面两个子项均失败', { source: SOURCE });
  }

  return { data, asOf: data.financials?.noticeDate ?? null, warnings: [], degraded };
}

// ---------------------------------------------------------------- news / announcements
/**
 * 新闻与公告（v1 只有东财：搜索新闻 + 公告列表合并）。
 * shortcut: 新浪降级未实现；新闻搜索按代码作 keyword（2026-11-17 实测 600519 可命中）。
 *
 * 2026-11-17 实测：
 * - 新闻 `search-api-web.eastmoney.com/search/jsonp`（JSONP 包裹 `cb({...})`）：
 *   result.cmsArticleWebOld[] = { code, title, content, mediaName, url, date }。
 * - 公告 `np-anotice-stock.eastmoney.com/api/security/ann`：
 *   data.list[] = { art_code, title, notice_date, display_time, codes[].stock_code }；
 *   详情页 URL 形如 `https://data.eastmoney.com/notices/detail/<code>/<art_code>.html`（实测 HTTP 200）。
 */
const NEWS_SEARCH_URL = 'https://search-api-web.eastmoney.com/search/jsonp';
const ANNOUNCEMENT_URL = 'https://np-anotice-stock.eastmoney.com/api/security/ann';

/** @param {string} text @returns {any} */
export function parseJsonp(text) {
  const start = String(text).indexOf('(');
  const end = String(text).lastIndexOf(')');
  if (start < 0 || end <= start) {
    throw new ProviderError(CODES.PARSE_ERROR, '响应不是 JSONP 包裹', { source: SOURCE });
  }
  try {
    return JSON.parse(String(text).slice(start + 1, end));
  } catch (error) {
    throw new ProviderError(CODES.PARSE_ERROR, 'JSONP 内部不是合法 JSON', { source: SOURCE, cause: error });
  }
}

/** `YYYY-MM-DD HH:mm:ss` → `YYYY-MM-DDTHH:mm:ss+08:00` */
function isoFromMinute(dateTime) {
  const text = String(dateTime ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) return null;
  return `${text.slice(0, 10)}T${text.slice(11, 19)}+08:00`;
}

/** @param {unknown} text @param {number} limit */
function truncate(text, limit) {
  const plain = String(text ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit)}…`;
}

/** point-in-time：发布时间不晚于 tradeDate 收盘（15:00）。 */
function publishedBeforeClose(publishTime, tradeDate) {
  return typeof publishTime === 'string' && publishTime <= `${tradeDate}T15:00:00+08:00`;
}

/**
 * 纯解析：东财新闻搜索 JSONP → items（point-in-time 过滤后按时间倒序）。
 * @param {string} text
 * @param {string} tradeDate
 * @param {number} [limit]
 */
export function parseNewsSearch(text, tradeDate, limit = 20) {
  const body = parseJsonp(text);
  const rows = body?.result?.cmsArticleWebOld;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '新闻搜索响应缺少 result.cmsArticleWebOld', { source: SOURCE });
  }
  return rows
    .map((row) => ({
      id: `news:${String(row.code ?? '')}`,
      kind: 'news',
      title: String(row.title ?? ''),
      url: row.url ?? null,
      source: row.mediaName ?? SOURCE,
      publishTime: isoFromMinute(row.date),
      summary: truncate(row.content, 120) || null,
    }))
    .filter((item) => item.title && publishedBeforeClose(item.publishTime, tradeDate))
    .sort((a, b) => String(b.publishTime).localeCompare(String(a.publishTime)))
    .slice(0, limit);
}

/**
 * 纯解析：东财公告列表 → items（point-in-time 过滤后按时间倒序）。
 * @param {any} body
 * @param {string} tradeDate
 * @param {number} [limit]
 */
export function parseAnnouncements(body, tradeDate, limit = 20) {
  const rows = body?.data?.list;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '公告响应缺少 data.list', { source: SOURCE });
  }
  return rows
    .map((row) => {
      const code = row.codes?.[0]?.stock_code ?? '';
      return {
        id: `ann:${String(row.art_code ?? '')}`,
        kind: 'announcement',
        title: String(row.title_ch || row.title || ''),
        url: row.art_code && code ? `https://data.eastmoney.com/notices/detail/${code}/${row.art_code}.html` : null,
        source: SOURCE,
        publishTime: isoFromMinute(row.display_time),
        summary: null,
      };
    })
    .filter((item) => item.title && publishedBeforeClose(item.publishTime, tradeDate))
    .sort((a, b) => String(b.publishTime).localeCompare(String(a.publishTime)))
    .slice(0, limit);
}

/**
 * 新闻类别合并（两个东财子源）：任一失败 → degraded 并说明缺哪块；两块都失败才抛错。
 * shortcut: 只取第 1 页（各 20 条）近期条目；更早的历史日需翻页/时间范围查询，升级时补。
 * @param {{ symbol: string, tradeDate: string, signal?: AbortSignal }} options
 */
export async function fetchNews({ symbol, tradeDate, signal }) {
  const parsed = parseSymbol(symbol);
  const newsUrl = `${NEWS_SEARCH_URL}?cb=cb&param=${encodeURIComponent(JSON.stringify({
    uid: '',
    keyword: parsed.symbol,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 20, preTag: '', postTag: '' } },
  }))}`;
  const announceUrl = `${ANNOUNCEMENT_URL}?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&stock_list=${parsed.symbol}&f_node=0&s_node=0`;

  const [newsOutcome, announceOutcome] = await Promise.allSettled([
    getText(newsUrl, { signal }).then((text) => parseNewsSearch(text, tradeDate)),
    getJson(announceUrl, { signal }).then((body) => parseAnnouncements(body, tradeDate)),
  ]);

  const items = [];
  const degraded = [];
  if (newsOutcome.status === 'fulfilled') {
    items.push(...newsOutcome.value);
  } else {
    const error = newsOutcome.reason;
    degraded.push(`新闻缺失：${error?.code ?? 'ERROR'} ${error?.message ?? ''}`.trim());
  }
  if (announceOutcome.status === 'fulfilled') {
    items.push(...announceOutcome.value);
  } else {
    const error = announceOutcome.reason;
    degraded.push(`公告缺失：${error?.code ?? 'ERROR'} ${error?.message ?? ''}`.trim());
  }
  if (items.length === 0 && degraded.length === 2) {
    throw new ProviderError(CODES.SOURCE_HTTP, '新闻与公告两个子源均失败', { source: SOURCE });
  }
  const sorted = items.sort((a, b) => String(b.publishTime).localeCompare(String(a.publishTime))).slice(0, 20);
  if (sorted.length === 0) {
    // 源正常但 tradeDate 收盘前没有条目：历史日第 1 页可能都是近期新闻（见 shortcut）。
    degraded.push(`tradeDate ${tradeDate} 收盘前无新闻/公告条目（源仅返回近期第 1 页）`);
  }
  return {
    data: { items: sorted },
    asOf: sorted[0]?.publishTime?.slice(0, 10) ?? null,
    warnings: [],
    degraded,
  };
}

// ---------------------------------------------------------------- moneyflow
/**
 * 资金流（东财日级资金流，单位元）。
 * 2026-11-17 实测：`push2his.eastmoney.com/api/qt/stock/fflow/daykline/get`，
 * fields2 顺序 = 日期, 主力净流入, 小单, 中单, 大单, 超大单, 主力净占比%, 小单占比%, 中单占比%,
 * 大单占比%, 超大单占比%, 收盘价, 涨跌幅%。校验：主力 = 大单 + 超大单。
 */
const MONEYFLOW_URL = 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get';

/**
 * 纯解析：资金流日线 → bars（升序，point-in-time 截断）。
 * @param {any} body
 * @param {string} tradeDate
 * @param {number} [days]
 */
export function parseMoneyflow(body, tradeDate, days = 20) {
  const rows = body?.data?.klines;
  if (!Array.isArray(rows)) {
    throw new ProviderError(CODES.SCHEMA_DRIFT, '资金流响应缺少 data.klines', { source: SOURCE });
  }
  if (rows.length === 0) {
    throw new ProviderError(CODES.EMPTY, '资金流为空', { source: SOURCE });
  }
  const bars = rows
    .map((row) => {
      const f = String(row).split(',');
      if (f.length < 13) {
        throw new ProviderError(CODES.SCHEMA_DRIFT, `资金流行字段数异常（${f.length}）`, { source: SOURCE });
      }
      return {
        date: f[0],
        mainNet: num(f[1]),
        smallNet: num(f[2]),
        mediumNet: num(f[3]),
        largeNet: num(f[4]),
        xlargeNet: num(f[5]),
        mainRatio: num(f[6]),
        close: num(f[11]),
        changePct: num(f[12]),
      };
    })
    .filter((bar) => bar.date <= tradeDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);
  if (bars.length === 0) {
    throw new ProviderError(CODES.EMPTY, `tradeDate ${tradeDate} 之前没有资金流数据`, { source: SOURCE });
  }
  return bars;
}

/** @param {{ symbol: string, tradeDate: string, signal?: AbortSignal }} options */
export async function fetchMoneyflow({ symbol, tradeDate, signal }) {
  const parsed = parseSymbol(symbol);
  const url = `${MONEYFLOW_URL}?lmt=30&klt=101&secid=${parsed.secid}`
    + '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65'
    + `&ut=${UT}`;
  const body = await getJson(url, { signal });
  const bars = parseMoneyflow(body, tradeDate);
  return {
    data: { bars },
    asOf: bars[bars.length - 1]?.date ?? null,
    warnings: [],
    degraded: [],
  };
}
