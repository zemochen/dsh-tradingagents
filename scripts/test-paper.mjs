#!/usr/bin/env node
/**
 * Paper account + watchlist tests (no network, stub quote):
 * fees, cap, average cost, partial close, reset, initial capital, watchlist,
 * and the HTTP routes through `createRuntime`.
 *
 * Usage: node scripts/test-paper.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_FEES, PaperError, closePosition, computeFees, loadPaper, openPosition,
  paperSnapshot, resetPaper, setInitialCapital,
} from '../src/pipeline/paper.mjs';
import { loadWatchlist, updateWatchlist } from '../src/pipeline/watchlist.mjs';
import { createRuntime } from '../index.js';

let assertions = 0;
async function check(name, fn) {
  await fn();
  assertions += 1;
  console.log(`ok - ${name}`);
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ta-paper-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const quoteStub = (price = 100) => async ({ symbol }) => ({
  ok: true,
  source: 'stub',
  asOf: '2026-11-24T15:00:00+08:00',
  quote: { symbol, name: '贵州茅台', price, changePct: 1.2 },
  attempts: [{ source: 'stub', ok: true, ms: 1 }],
});

await check('computeFees：佣金下限/印花税仅卖出/过户费北交所不单收', () => {
  const buy = computeFees({ side: 'open', amount: 100_000, exchange: 'sh' });
  assert.deepEqual(buy, { commission: 30, stamp: 0, transfer: 1, total: 31 });
  const sell = computeFees({ side: 'close', amount: 100_000, exchange: 'sz' });
  assert.deepEqual(sell, { commission: 30, stamp: 50, transfer: 1, total: 81 });
  const tiny = computeFees({ side: 'open', amount: 1_000, exchange: 'sh' });
  assert.equal(tiny.commission, 5, '最低佣金 5 元');
  const bj = computeFees({ side: 'open', amount: 100_000, exchange: 'bj' });
  assert.equal(bj.transfer, 0, '北交所过户费并入佣金');
});

await check('建仓/分批/上限/平均成本/部分平仓/清仓/重置', () => withTempDir(async (dir) => {
  const base = { homeDir: dir, symbol: '600519', name: '贵州茅台', price: 100, reportId: 'r-1', positionPct: 20 };
  const first = await openPosition({ ...base, shares: 1000 });
  assert.equal(first.trade.amount, 100_000);
  assert.deepEqual(first.trade.fees, { commission: 30, stamp: 0, transfer: 1, total: 31 });
  assert.equal(first.account.cash, 899_969);
  assert.equal(first.position.shares, 1000);
  assert.equal(first.position.avgCost, 100.03);
  assert.equal(first.position.capAmount, 200_000, '上限 = 总资产 × 20%');

  const second = await openPosition({ ...base, shares: 500 });
  assert.equal(second.position.shares, 1500);
  assert.equal(second.position.costBasis, 150_000);
  assert.ok(second.position.avgCost > 100 && second.position.avgCost < 101);

  await assert.rejects(
    () => openPosition({ ...base, shares: 600 }),
    (error) => error instanceof PaperError && error.code === 'CAP_EXCEEDED',
  );
  await assert.rejects(
    () => openPosition({ ...base, shares: 150 }),
    (error) => error.code === 'INVALID_SHARES',
  );

  const partial = await closePosition({ homeDir: dir, symbol: '600519', shares: 500, price: 110 });
  assert.equal(partial.trade.fees.commission, 16.5);
  assert.equal(partial.trade.fees.stamp, 27.5);
  assert.equal(partial.positions[0].shares, 1000);
  assert.ok(partial.account.cash > 900_000);

  const cleared = await closePosition({ homeDir: dir, symbol: '600519', shares: 1000, price: 110 });
  assert.equal(cleared.positions.length, 0);
  await assert.rejects(
    () => closePosition({ homeDir: dir, symbol: '600519', shares: 100, price: 110 }),
    (error) => error.code === 'NO_POSITION',
  );

  const reset = await resetPaper(dir);
  assert.equal(reset.account.cash, 1_000_000);
  assert.equal(reset.positions.length, 0);
  assert.equal(reset.trades.length, 0);
}));

await check('现金不足与初始资金修改（有持仓拒绝）', () => withTempDir(async (dir) => {
  const base = { homeDir: dir, symbol: '600519', name: '贵州茅台', price: 100, reportId: 'r-1', positionPct: 100 };
  await openPosition({ ...base, shares: 1000 });
  await assert.rejects(
    () => openPosition({ ...base, shares: 9000 }),
    (error) => error.code === 'INSUFFICIENT_CASH',
  );
  await assert.rejects(
    () => setInitialCapital({ homeDir: dir, initialCapital: 2_000_000 }),
    (error) => error.code === 'POSITION_OPEN',
  );
  await resetPaper(dir);
  const changed = await setInitialCapital({ homeDir: dir, initialCapital: 2_000_000 });
  assert.equal(changed.account.initialCapital, 2_000_000);
  assert.equal(changed.account.cash, 2_000_000);
}));

await check('自选列表增删与非法代码拒绝', () => withTempDir(async (dir) => {
  assert.deepEqual((await loadWatchlist(dir)).symbols, []);
  const added = await updateWatchlist({ homeDir: dir, add: ['600519', '000001', '600519'] });
  assert.deepEqual(added.symbols, ['600519', '000001'], '去重且保序');
  const removed = await updateWatchlist({ homeDir: dir, remove: ['000001'] });
  assert.deepEqual(removed.symbols, ['600519']);
  await assert.rejects(() => updateWatchlist({ homeDir: dir, add: ['abc'] }), (error) => error.code === 'INVALID_SYMBOL');
}));

await check('HTTP 路由：watchlist / quotes / paper 全链路（stub 行情）', () => withTempDir(async (dir) => {
  const runtime = createRuntime({ homeDir: dir, quote: quoteStub(100), config: { fees: DEFAULT_FEES } });
  const call = async (path, init) => {
    const response = await runtime.handleFetch(new Request(`http://127.0.0.1/dsh-tradingagents/api${path}`, init));
    return { status: response.status, body: await response.json() };
  };
  const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) });

  assert.deepEqual((await call('/watchlist')).body.symbols, []);
  assert.deepEqual((await post('/watchlist', { add: ['600519'] })).body.symbols, ['600519']);
  const quotes = await call('/quotes?symbols=600519');
  assert.equal(quotes.status, 200);
  assert.equal(quotes.body.quotes['600519'].ok, true);
  assert.equal(quotes.body.quotes['600519'].price, 100);

  // Minimal report file is enough for /paper/open (it reads symbol/name/verdict).
  await mkdir(join(dir, 'reports'), { recursive: true });
  await writeFile(join(dir, 'reports', 'r-1.decision.json'), JSON.stringify({
    symbol: '600519', name: '贵州茅台', verdict: { positionPct: 20 },
  }));
  const opened = await post('/paper/open', { reportId: 'r-1', shares: 1000 });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.position.shares, 1000);
  assert.equal(opened.body.account.cash, 899_969);

  const snapshot = await call('/paper');
  assert.equal(snapshot.body.positions.length, 1);
  assert.equal(snapshot.body.account.totalAssets, 999_999, '成本法总资产（已扣费用）');

  const closed = await post('/paper/close', { symbol: '600519', shares: 1000 });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.positions.length, 0);

  assert.equal((await post('/paper/reset', {})).status, 200);
  assert.equal((await post('/paper/initial-capital', { initialCapital: 500_000 })).body.account.cash, 500_000);
  const invalid = await post('/paper/open', { reportId: 'missing', shares: 100 });
  assert.equal(invalid.status, 404);
}));

await check('行情不可用时建仓 → 503 QUOTE_UNAVAILABLE', () => withTempDir(async (dir) => {
  await mkdir(join(dir, 'reports'), { recursive: true });
  await writeFile(join(dir, 'reports', 'r-1.decision.json'), JSON.stringify({ symbol: '600519', verdict: { positionPct: 10 } }));
  const runtime = createRuntime({
    homeDir: dir,
    quote: async () => ({ ok: false, attempts: [{ source: 'eastmoney', ok: false, ms: 5, error: { code: 'SOURCE_TIMEOUT', message: 'timeout' } }], error: { code: 'SOURCE_TIMEOUT', message: 'timeout' } }),
    config: { fees: DEFAULT_FEES },
  });
  const response = await runtime.handleFetch(new Request('http://127.0.0.1/dsh-tradingagents/api/paper/open', {
    method: 'POST', body: JSON.stringify({ reportId: 'r-1', shares: 100 }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'QUOTE_UNAVAILABLE');
}));

console.log(`\ntest-paper: OK — ${assertions} 个用例全部通过（stub 行情、无网络）`);
