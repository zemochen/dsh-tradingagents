#!/usr/bin/env node
/**
 * 数据层解析/归一化的 fixture 回归测试（不联网）。
 * fixture 均为 2026-11-17 真实抓取，见 `src/data/fixtures/README.md`。
 *
 *   node scripts/test-data.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODES, ProviderError } from '../src/data/errors.mjs';
import {
  assertTradeDate, isoFromCompactStamp, isoFromDateTime, isoFromEpochSeconds,
  lotsToShares, num, parseSymbol, scaled, todayShanghai,
} from '../src/data/normalize.mjs';
import {
  parseAnnouncements as parseEastmoneyAnnouncements,
  parseFinancials as parseEastmoneyFinancials,
  parseIndexDay as parseEastmoneyIndexDay,
  parseKlines as parseEastmoneyKlines,
  parseMoneyflow as parseEastmoneyMoneyflow,
  parseNewsSearch as parseEastmoneyNewsSearch,
  parseQuote as parseEastmoneyQuote,
  parseValuation as parseEastmoneyValuation,
} from '../src/data/providers/eastmoney.mjs';
import {
  parseIndexDay as parseTencentIndexDay,
  parseKlines as parseTencentKlines,
  parseQuote as parseTencentQuote,
} from '../src/data/providers/tencent.mjs';
import { parseQuote as parseSinaQuote } from '../src/data/providers/sina.mjs';
import { deriveHistoricalQuote } from '../src/data/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => readFileSync(join(root, 'src/data/fixtures', name));
const fixtureText = (name) => fixture(name).toString('utf8');
const fixtureGbk = (name) => new TextDecoder('gbk').decode(fixture(name));

let assertions = 0;
function check(name, fn) {
  fn();
  assertions += 1;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------- normalize
check('parseSymbol 沪/深/北', () => {
  const sh = parseSymbol('600519');
  assert.equal(sh.exchange, 'sh');
  assert.equal(sh.secid, '1.600519');
  const sz = parseSymbol('000001');
  assert.equal(sz.exchange, 'sz');
  assert.equal(sz.secid, '0.000001');
  const bj = parseSymbol('830799');
  assert.equal(bj.exchange, 'bj');
  assert.equal(bj.secid, '0.830799');
});

check('parseSymbol 拒绝 B 股 / 非法输入', () => {
  for (const bad of ['900901', '200002', '123456', '60051', 'abc']) {
    assert.throws(() => parseSymbol(bad), (error) => error.code === CODES.INVALID_SYMBOL, `应拒绝 ${bad}`);
  }
});

check('units: num / scaled / lotsToShares', () => {
  assert.equal(num('-'), null);
  assert.equal(num(''), null);
  assert.equal(num(null), null);
  assert.equal(num('1457.70'), 1457.7);
  assert.equal(scaled(145770, 100), 1457.7);
  assert.equal(lotsToShares(35116), 3511600);
  assert.equal(lotsToShares(null), null);
});

check('times: ISO8601 +08:00', () => {
  assert.equal(isoFromEpochSeconds(1794903103), '2026-11-17T16:11:43+08:00');
  assert.equal(isoFromCompactStamp('20261117161443'), '2026-11-17T16:14:43+08:00');
  assert.equal(isoFromDateTime('2026-11-17', '15:34:58'), '2026-11-17T15:34:58+08:00');
  assert.equal(todayShanghai(new Date('2026-11-17T20:00:00+08:00')), '2026-11-17');
});

check('assertTradeDate: 未来日期拒绝', () => {
  const now = new Date('2026-11-17T20:00:00+08:00');
  assert.equal(assertTradeDate('2026-11-17', { now }), '2026-11-17');
  assert.throws(() => assertTradeDate('2026-12-01', { now }), (error) => error.code === CODES.FUTURE_DATE);
  assert.throws(() => assertTradeDate('2026/11/17', { now }), (error) => error.code === CODES.FUTURE_DATE);
});

// ---------------------------------------------------------------- quotes
check('eastmoney parseQuote（真实 fixture）', () => {
  const quote = parseEastmoneyQuote(JSON.parse(fixtureText('eastmoney-quote-600519-20261117.json')));
  assert.equal(quote.symbol, '600519');
  assert.equal(quote.name, '贵州茅台');
  assert.equal(quote.price, 1457.7);
  assert.equal(quote.prevClose, 1453.9);
  assert.equal(quote.open, 1458.88);
  assert.equal(quote.high, 1461.6);
  assert.equal(quote.low, 1437.71);
  assert.equal(quote.volumeShares, 3511600);
  assert.equal(quote.amount, 5094594655);
  assert.equal(quote.change, 3.8);
  assert.equal(quote.changePct, 0.26);
  assert.equal(quote.asOf, '2026-11-17T16:11:43+08:00');
});

check('tencent parseQuote（GBK 真实 fixture）', () => {
  const quote = parseTencentQuote(fixtureGbk('tencent-quote-600519-20261117.txt'));
  assert.equal(quote.symbol, '600519');
  assert.equal(quote.name, '贵州茅台');
  assert.equal(quote.price, 1457.7);
  assert.equal(quote.prevClose, 1453.9);
  assert.equal(quote.open, 1458.88);
  assert.equal(quote.high, 1461.6);
  assert.equal(quote.low, 1437.71);
  assert.equal(quote.volumeShares, 3511600);
  assert.equal(quote.amount, 5094594655);
  assert.equal(quote.change, 3.8);
  assert.equal(quote.changePct, 0.26);
  assert.equal(quote.asOf, '2026-11-17T16:14:43+08:00');
});

check('sina parseQuote（GBK 真实 fixture）', () => {
  const quote = parseSinaQuote(fixtureGbk('sina-quote-600519-20261117.txt'));
  assert.equal(quote.symbol, '600519');
  assert.equal(quote.name, '贵州茅台');
  assert.equal(quote.price, 1457.7);
  assert.equal(quote.prevClose, 1453.9);
  assert.equal(quote.open, 1458.88);
  assert.equal(quote.high, 1461.6);
  assert.equal(quote.low, 1437.71);
  assert.equal(quote.volumeShares, 3511645);
  assert.equal(quote.amount, 5094594655);
  assert.equal(quote.asOf, '2026-11-17T15:34:58+08:00');
});

// ---------------------------------------------------------------- klines
check('eastmoney parseKlines（真实 fixture）', () => {
  const parsed = parseEastmoneyKlines(JSON.parse(fixtureText('eastmoney-kline-600519-20261103-20261117.json')));
  assert.equal(parsed.bars.length, 11);
  assert.equal(parsed.adjusted, true);
  assert.equal(parsed.bars[0].date, '2026-11-03');
  assert.equal(parsed.bars[0].close, 1480);
  assert.equal(parsed.bars.at(-1).date, '2026-11-17');
  assert.equal(parsed.bars.at(-1).close, 1457.7);
  assert.equal(parsed.bars.at(-1).volumeShares, 3511600);
  assert.equal(parsed.bars.at(-1).amount, 5094594655);
  // K 线最后一根收盘价与同日行情现价一致
  const quote = parseEastmoneyQuote(JSON.parse(fixtureText('eastmoney-quote-600519-20261117.json')));
  assert.equal(parsed.bars.at(-1).close, quote.price);
});

check('tencent parseKlines（真实 fixture，缺成交额 → 标记）', () => {
  const parsed = parseTencentKlines(
    JSON.parse(fixtureText('tencent-kline-600519-20261110-20261117.json')),
    '600519',
  );
  assert.equal(parsed.bars.length, 6);
  assert.equal(parsed.adjusted, true);
  assert.equal(parsed.bars[0].date, '2026-11-10');
  assert.equal(parsed.bars.at(-1).date, '2026-11-17');
  assert.equal(parsed.bars.at(-1).close, 1457.7);
  assert.equal(parsed.bars.at(-1).volumeShares, 3511600);
  assert.equal(parsed.bars.at(-1).amount, null);
  assert.ok(parsed.warnings.some((warning) => warning.includes('不含成交额')));
});

// ---------------------------------------------------------------- fundamentals
check('eastmoney parseValuation（真实 fixture）', () => {
  const valuation = parseEastmoneyValuation(JSON.parse(fixtureText('eastmoney-valuation-600519-20261117.json')));
  assert.equal(valuation.symbol, '600519');
  assert.equal(valuation.price, 1457.7);
  assert.equal(valuation.marketCap, 1822243949777.7);
  assert.equal(valuation.floatMarketCap, 1822243949777.7);
  assert.equal(valuation.peDynamic, 21.2);
  assert.equal(valuation.peStatic, 22.14);
  assert.equal(valuation.peTtm, 22.18);
  assert.equal(valuation.pb, 6.72);
  assert.equal(valuation.industry, '白酒Ⅱ');
  assert.equal(valuation.sector, '贵州板块');
});

check('eastmoney parseFinancials：最新已披露报告 + point-in-time', () => {
  const body = JSON.parse(fixtureText('eastmoney-financials-600519-20261117.json'));

  const latest = parseEastmoneyFinancials(body, '2026-11-17');
  assert.equal(latest.reportDate, '2026-09-30');
  assert.equal(latest.reportType, '三季报');
  assert.equal(latest.noticeDate, '2026-10-31');
  assert.equal(latest.revenue, 133283652508.95);
  assert.equal(latest.revenueYoY, 1.817946648268);
  assert.equal(latest.netProfit, 64467425981.95);
  assert.equal(latest.roe, 24.47);
  assert.equal(latest.grossMargin, 89.581093798);
  assert.equal(latest.debtRatio, 11.9015685357);

  // 2026-05-01 时一季报（2026-04-25 公告，报告期 2026-03-31）已披露 → 取报告期最新的那一期
  const historical = parseEastmoneyFinancials(body, '2026-05-01');
  assert.equal(historical.reportDate, '2026-03-31');
  assert.equal(historical.reportType, '一季报');

  // 2025-10-01 时 fixture 里最早的公告（2025-10-30）尚未发布 → 显式失败，不拿未来报告
  assert.throws(() => parseEastmoneyFinancials(body, '2025-10-01'), (error) => error.code === CODES.EMPTY);
});

// ---------------------------------------------------------------- news / announcements
check('eastmoney parseNewsSearch（JSONP + point-in-time）', () => {
  const text = fixtureText('eastmoney-news-search-600519-20261117.txt');

  const at17 = parseEastmoneyNewsSearch(text, '2026-11-17');
  assert.equal(at17.length, 4);
  assert.equal(at17[0].publishTime, '2026-11-16T19:11:40+08:00');
  assert.ok(at17[0].title.includes('13只白酒股上涨'));
  assert.equal(at17[0].source, '北京商报');
  assert.ok(at17[0].url.startsWith('http'));
  assert.ok(at17[0].summary.length > 0);
  assert.equal(at17[0].kind, 'news');

  // 2026-11-16 收盘（15:00）前无可用新闻：15:42/17:29/19:11/15:19 均晚于收盘
  assert.equal(parseEastmoneyNewsSearch(text, '2026-11-16').length, 0);
});

check('eastmoney parseAnnouncements（point-in-time + 详情 URL）', () => {
  const body = JSON.parse(fixtureText('eastmoney-announcements-600519-20261117.json'));

  const at03 = parseEastmoneyAnnouncements(body, '2026-11-03');
  assert.equal(at03.length, 5);
  assert.equal(at03[0].kind, 'announcement');
  assert.equal(at03[0].publishTime, '2026-11-02T16:59:12+08:00');
  assert.ok(at03[0].url.includes('AN202611021831320924'));
  assert.equal(at03[0].summary, null);

  // 11-02 收盘前：当天 16:59 的公告不可得，只能看到更早的 4 条
  const at02 = parseEastmoneyAnnouncements(body, '2026-11-02');
  assert.equal(at02.length, 4);
  assert.equal(at02[0].publishTime, '2026-10-30T18:31:37+08:00');
});

// ---------------------------------------------------------------- moneyflow
check('eastmoney parseMoneyflow（字段顺序 + 主力=大单+超大单 + point-in-time）', () => {
  const body = JSON.parse(fixtureText('eastmoney-moneyflow-600519-20261117.json'));

  const bars = parseEastmoneyMoneyflow(body, '2026-11-17');
  assert.equal(bars.length, 10);
  const last = bars[bars.length - 1];
  assert.equal(last.date, '2026-11-17');
  assert.equal(last.mainNet, 220370656);
  assert.equal(last.close, 1457.7);
  assert.equal(last.mainRatio, 4.33);
  for (const bar of bars) {
    assert.ok(Math.abs(bar.mainNet - (bar.largeNet + bar.xlargeNet)) < 0.01, `${bar.date} 主力=大单+超大单`);
  }

  const historical = parseEastmoneyMoneyflow(body, '2026-11-10');
  assert.equal(historical.length, 5);
  assert.equal(historical[historical.length - 1].date, '2026-11-10');
});

// ---------------------------------------------------------------- calendar
check('calendar 东财单日 K：交易日 / 非交易日', () => {
  const trading = parseEastmoneyIndexDay(JSON.parse(fixtureText('eastmoney-index-kline-20261117-trading.json')), '2026-11-17');
  assert.equal(trading.trading, true);
  const nonTrading = parseEastmoneyIndexDay(JSON.parse(fixtureText('eastmoney-index-kline-20261115-nontrading.json')), '2026-11-15');
  assert.equal(nonTrading.trading, false);
});

check('calendar 腾讯单日 K：交易日 / 非交易日', () => {
  const trading = parseTencentIndexDay(JSON.parse(fixtureText('tencent-index-kline-20261117-trading.json')), '2026-11-17');
  assert.equal(trading.trading, true);
  const nonTrading = parseTencentIndexDay(JSON.parse(fixtureText('tencent-index-kline-20261115-nontrading.json')), '2026-11-15');
  assert.equal(nonTrading.trading, false);
});

// ---------------------------------------------------------------- historical quote
check('历史日 quote 由当日 K 线派生（point-in-time）', () => {
  const parsed = parseEastmoneyKlines(JSON.parse(fixtureText('eastmoney-kline-600519-20261103-20261117.json')));
  const klinesResult = {
    status: 'ok',
    source: 'eastmoney',
    fetchedAt: '2026-11-17T20:20:00+08:00',
    data: { bars: parsed.bars, adjusted: true },
    attempts: [],
    warnings: [],
  };
  const quote = deriveHistoricalQuote(klinesResult, { symbol: '600519', tradeDate: '2026-11-13' });
  assert.equal(quote.status, 'ok');
  assert.equal(quote.asOf, '2026-11-13T15:00:00+08:00');
  assert.equal(quote.data.price, 1435.26);
  assert.equal(quote.data.prevClose, 1410.27);
  assert.equal(quote.data.open, 1404);
  assert.equal(quote.data.high, 1437.69);
  assert.equal(quote.data.low, 1394);
  assert.equal(quote.data.volumeShares, 4178000);
  assert.ok(quote.warnings.some((warning) => warning.includes('point-in-time')));

  const missing = deriveHistoricalQuote({ status: 'missing', source: null, attempts: [], warnings: [] }, { symbol: '600519', tradeDate: '2026-11-13' });
  assert.equal(missing.status, 'missing');
  assert.ok(missing.attempts.length > 0);
});

// ---------------------------------------------------------------- errors
check('错误分类：缺字段 → SCHEMA_DRIFT；坏文本 → PARSE_ERROR', () => {
  assert.throws(() => parseEastmoneyQuote({}), (error) => error instanceof ProviderError && error.code === CODES.SCHEMA_DRIFT);
  assert.throws(() => parseTencentQuote('garbage'), (error) => error instanceof ProviderError && error.code === CODES.PARSE_ERROR);
  assert.throws(() => parseSinaQuote('garbage'), (error) => error instanceof ProviderError && error.code === CODES.PARSE_ERROR);
});

console.log(`\ntest-data: OK — ${assertions} 个用例全部通过（fixture 来自 2026-11-17 真实响应）`);
