#!/usr/bin/env node
/**
 * 数据层真实 smoke 检查（不做 mock）：
 *   node scripts/check-data.mjs <6位代码> [YYYY-MM-DD] [--json] [--allow-missing]
 *
 * 退出码：0 全部类别 ok；1 fatal / 未预期错误；2 输入被拒（重选日期 / 代码非法）；
 *        3 有类别缺失但未 fatal（加 --allow-missing 可降为 0）。
 */
import { fetchSnapshot, InputRejectedError } from '../src/data/index.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));
const [symbol, tradeDate] = positional;

if (!symbol) {
  console.error('用法: node scripts/check-data.mjs <6位代码> [YYYY-MM-DD] [--json] [--allow-missing]');
  process.exit(64);
}

/** @param {any} snapshot */
function printSummary(snapshot) {
  console.log(`symbol=${snapshot.symbol} exchange=${snapshot.exchange} tradeDate=${snapshot.tradeDate} snapshotAt=${snapshot.snapshotAt}`);
  for (const [category, result] of Object.entries(snapshot.categories)) {
    const attemptText = result.attempts
      .map((attempt) => `${attempt.source}${attempt.ok ? '=ok' : `=${attempt.error?.code ?? 'ERR'}`}`)
      .join(' → ');
    console.log(
      `- ${category.padEnd(12)} ${result.status.padEnd(8)} source=${String(result.source ?? '-').padEnd(10)}`
      + ` asOf=${String(result.asOf ?? '-').padEnd(30)} attempts: ${attemptText}`,
    );
    if (result.warnings?.length) console.log(`    warnings: ${result.warnings.join(' | ')}`);
    if (category === 'quote' && result.data) {
      const q = result.data;
      console.log(`    quote: ${q.name} ${q.price} (${q.changePct}%) prevClose=${q.prevClose} open=${q.open} high=${q.high} low=${q.low} volumeShares=${q.volumeShares} amount=${q.amount}`);
    }
    if (category === 'fundamentals' && result.data) {
      const { valuation, financials } = result.data;
      const yi = (value) => (value === null || value === undefined ? '-' : `${(value / 1e8).toFixed(2)}亿`);
      const pct = (value) => (value === null || value === undefined ? '-' : `${Number(value).toFixed(2)}%`);
      console.log(`    financials: report=${financials?.reportDate ?? '-'} ${financials?.reportType ?? ''} 公告=${financials?.noticeDate ?? '-'} 营收=${yi(financials?.revenue)} 同比=${pct(financials?.revenueYoY)} 归母净利=${yi(financials?.netProfit)} 同比=${pct(financials?.netProfitYoY)} ROE=${pct(financials?.roe)} 毛利率=${pct(financials?.grossMargin)} 资产负债率=${pct(financials?.debtRatio)}`);
      if (valuation) console.log(`    valuation: PE(TTM)=${valuation.peTtm} PE(动)=${valuation.peDynamic} PB=${valuation.pb} 总市值=${yi(valuation.marketCap)} 行业=${valuation.industry} 板块=${valuation.sector}`);
    }
    if (category === 'news' && result.data) {
      const items = result.data.items;
      const kinds = items.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] ?? 0) + 1 }), {});
      console.log(`    news: ${items.length} 条（news=${kinds.news ?? 0}, announcement=${kinds.announcement ?? 0}）`);
      for (const item of items.slice(0, 2)) console.log(`      - [${item.kind}] ${item.publishTime} ${item.source} | ${item.title.slice(0, 40)}`);
    }
    if (category === 'moneyflow' && result.data) {
      const bars = result.data.bars;
      const last = bars[bars.length - 1];
      const yi = (value) => (value === null || value === undefined ? '-' : `${(value / 1e8).toFixed(2)}亿`);
      console.log(`    moneyflow: ${bars.length} 日, 最新 ${last?.date} 主力净流入=${yi(last?.mainNet)} 大单=${yi(last?.largeNet)} 超大单=${yi(last?.xlargeNet)} 主力占比=${last?.mainRatio}%`);
    }
    if (category === 'klines' && result.data) {
      const bars = result.data.bars;
      console.log(`    klines: ${bars.length} 根, ${bars[0]?.date} → ${bars[bars.length - 1]?.date}, adjusted=${result.data.adjusted}`);
    }
  }
  if (snapshot.missing.length) console.log(`missing: ${snapshot.missing.join(', ')}`);
  if (snapshot.fatal) console.log(`FATAL: ${snapshot.fatal.reason.code} ${snapshot.fatal.reason.message}`);
}

try {
  const snapshot = await fetchSnapshot({ symbol, tradeDate });

  if (flags.has('--json')) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    printSummary(snapshot);
  }

  if (snapshot.fatal) process.exit(1);
  const missingWithoutQuote = snapshot.missing.filter((category) => category !== 'quote');
  if (missingWithoutQuote.length > 0) {
    process.exit(flags.has('--allow-missing') ? 0 : 3);
  }
} catch (error) {
  if (error instanceof InputRejectedError) {
    console.error(`INPUT_REJECTED [${error.code}] ${error.message}`);
    if (Array.isArray(error.attempts)) {
      console.error(`  calendar attempts: ${error.attempts.map((a) => `${a.source}${a.ok ? '=ok' : `=${a.error?.code}`}`).join(', ')}`);
    }
    process.exit(2);
  }
  console.error(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
}
