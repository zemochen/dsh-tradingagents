/**
 * Paper account: virtual positions/trades with real A-share fees.
 * Contract: `<DOCS>/design/paper.md` (R1 建议即仓位, Q12–Q18).
 *
 * Total assets for the position cap use **cost basis** (cash + Σ shares×avgCost)
 * to avoid extra quote requests; the report's suggestedPositionPct is applied to
 * that number once, at the first open. Documented simplification.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSymbol } from '../data/normalize.mjs';
import { defaultHomeDir } from './report.mjs';

export const DEFAULT_FEES = Object.freeze({
  commissionRate: 0.0003,
  minCommission: 5,
  stampRate: 0.0005,
  transferRate: 0.00001,
});

export class PaperError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'PaperError';
    this.code = code;
    this.status = status;
  }
}

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** @param {string} homeDir */
export function paperDir(homeDir = defaultHomeDir()) {
  return join(homeDir, 'paper');
}

/** @returns {string} */
function timestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
}

/**
 * @param {{ side: 'open'|'close', amount: number, exchange?: string, fees?: any }} input
 * @returns {{ commission: number, stamp: number, transfer: number, total: number }}
 */
export function computeFees({ side, amount, exchange = 'sh', fees = DEFAULT_FEES }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new PaperError('INVALID_AMOUNT', '成交额非法');
  const commission = round2(Math.max(fees.minCommission, value * fees.commissionRate));
  const stamp = side === 'close' ? round2(value * fees.stampRate) : 0;
  // Beijing exchange folds transfer fee into commission (甬兴公示备注; 未逐笔实测).
  const transfer = exchange === 'bj' ? 0 : round2(value * fees.transferRate);
  return { commission, stamp, transfer, total: round2(commission + stamp + transfer) };
}

/** @param {string} file @param {string} content */
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

/** @param {string} file @param {any} fallback */
async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** @param {string} homeDir */
function accountFile(homeDir) { return join(paperDir(homeDir), 'account.json'); }
/** @param {string} homeDir */
function positionsFile(homeDir) { return join(paperDir(homeDir), 'positions.json'); }
/** @param {string} homeDir */
function tradesFile(homeDir) { return join(paperDir(homeDir), 'trades.json'); }

/**
 * @param {string} homeDir
 * @returns {Promise<{ account: any, positions: any[], trades: any[] }>}
 */
export async function loadPaper(homeDir = defaultHomeDir()) {
  const dir = paperDir(homeDir);
  await mkdir(dir, { recursive: true });
  const account = await readJson(accountFile(homeDir), {
    version: 1, initialCapital: 1_000_000, cash: 1_000_000, updatedAt: null,
  });
  const positions = await readJson(positionsFile(homeDir), []);
  const trades = await readJson(tradesFile(homeDir), []);
  return { account, positions: Array.isArray(positions) ? positions : [], trades: Array.isArray(trades) ? trades : [] };
}

/**
 * @param {{ account: any, positions: any[], trades: any[] }} state
 * @param {string} homeDir
 */
async function savePaper(state, homeDir) {
  const files = [
    [accountFile(homeDir), state.account],
    [positionsFile(homeDir), state.positions],
    [tradesFile(homeDir), state.trades],
  ];
  for (const [file, value] of files) await writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** @param {any[]} positions */
function totalAssets(account, positions) {
  const cost = positions.reduce((sum, position) => sum + position.shares * position.avgCost, 0);
  return round2(account.cash + cost);
}

/**
 * @param {{
 *   homeDir?: string, symbol: string, name?: string|null, shares: number,
 *   price: number, quoteSource?: string|null, quoteAsOf?: string|null,
 *   reportId: string, positionPct: number, fees?: any,
 * }} input
 */
export async function openPosition({
  homeDir = defaultHomeDir(), symbol, name = null, shares, price,
  quoteSource = null, quoteAsOf = null, reportId, positionPct, fees = DEFAULT_FEES,
}) {
  const parsed = parseSymbol(symbol);
  const lots = Math.floor(Number(shares) / 100);
  if (!Number.isFinite(Number(shares)) || lots < 1 || lots * 100 !== Number(shares)) {
    throw new PaperError('INVALID_SHARES', '股数必须是 100 的整数倍');
  }
  const unitPrice = Number(price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new PaperError('INVALID_PRICE', '成交价非法');
  const pct = Number(positionPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new PaperError('INVALID_POSITION_PCT', '建议仓位非法');

  const state = await loadPaper(homeDir);
  const amount = round2(unitPrice * Number(shares));
  const cost = computeFees({ side: 'open', amount, exchange: parsed.exchange, fees });
  const total = round2(amount + cost.total);

  let position = state.positions.find((item) => item.symbol === parsed.symbol);
  const capAmount = position?.capAmount ?? round2(totalAssets(state.account, state.positions) * (pct / 100));
  const costBasis = position?.costBasis ?? 0;
  if (round2(costBasis + amount) > capAmount + 0.01) {
    throw new PaperError('CAP_EXCEEDED', `超出建议仓位上限（已建 ${costBasis}，本次 ${amount}，上限 ${capAmount}）`);
  }
  if (state.account.cash < total) {
    throw new PaperError('INSUFFICIENT_CASH', `现金不足（可用 ${round2(state.account.cash)}，需要 ${total}）`);
  }

  const trade = {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'open', symbol: parsed.symbol, name,
    shares: Number(shares), price: unitPrice, amount,
    fees: cost,
    quoteSource, quoteAsOf,
    at: timestamp(), reportId,
  };
  state.account.cash = round2(state.account.cash - total);
  state.account.updatedAt = trade.at;
  if (position) {
    const previousCost = position.shares * position.avgCost;
    position.shares += Number(shares);
    position.avgCost = round2((previousCost + total) / position.shares);
    position.costBasis = round2(costBasis + amount);
  } else {
    position = {
      symbol: parsed.symbol, name, shares: Number(shares),
      avgCost: round2(total / Number(shares)), costBasis: amount,
      reportId, positionPct: pct, capAmount, openedAt: trade.at,
    };
    state.positions.push(position);
  }
  state.trades.unshift(trade);
  await savePaper(state, homeDir);
  return { trade, position, account: state.account, positions: state.positions };
}

/**
 * @param {{ homeDir?: string, symbol: string, shares: number, price: number, fees?: any }} input
 */
export async function closePosition({ homeDir = defaultHomeDir(), symbol, shares, price, fees = DEFAULT_FEES }) {
  const parsed = parseSymbol(symbol);
  const state = await loadPaper(homeDir);
  const position = state.positions.find((item) => item.symbol === parsed.symbol);
  if (!position) throw new PaperError('NO_POSITION', `没有持仓：${parsed.symbol}`, 404);
  const lots = Math.floor(Number(shares) / 100);
  if (!Number.isFinite(Number(shares)) || lots < 1 || lots * 100 !== Number(shares)) {
    throw new PaperError('INVALID_SHARES', '股数必须是 100 的整数倍');
  }
  if (Number(shares) > position.shares) throw new PaperError('INVALID_SHARES', `超过持仓股数（${position.shares}）`);
  const unitPrice = Number(price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new PaperError('INVALID_PRICE', '成交价非法');

  const amount = round2(unitPrice * Number(shares));
  const cost = computeFees({ side: 'close', amount, exchange: parsed.exchange, fees });
  const net = round2(amount - cost.total);
  const trade = {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'close', symbol: parsed.symbol, name: position.name,
    shares: Number(shares), price: unitPrice, amount, fees: cost,
    at: timestamp(), reportId: position.reportId,
  };
  state.account.cash = round2(state.account.cash + net);
  state.account.updatedAt = trade.at;
  position.shares -= Number(shares);
  position.costBasis = round2(position.costBasis * (1 - Number(shares) / (position.shares + Number(shares))));
  if (position.shares <= 0) state.positions = state.positions.filter((item) => item.symbol !== parsed.symbol);
  state.trades.unshift(trade);
  await savePaper(state, homeDir);
  return { trade, account: state.account, positions: state.positions };
}

/** @param {string} [homeDir] */
export async function resetPaper(homeDir = defaultHomeDir()) {
  const account = { version: 1, initialCapital: 1_000_000, cash: 1_000_000, updatedAt: timestamp() };
  await savePaper({ account, positions: [], trades: [] }, homeDir);
  return { account, positions: [], trades: [] };
}

/**
 * Only allowed with no open positions (paper.md §8); cash resets to the new capital.
 * @param {{ homeDir?: string, initialCapital: number }} input
 */
export async function setInitialCapital({ homeDir = defaultHomeDir(), initialCapital }) {
  const value = Number(initialCapital);
  if (!Number.isFinite(value) || value <= 0) throw new PaperError('INVALID_CAPITAL', '初始资金必须为正数');
  const state = await loadPaper(homeDir);
  if (state.positions.length > 0) throw new PaperError('POSITION_OPEN', '有持仓时不能修改初始资金', 409);
  state.account = { version: 1, initialCapital: round2(value), cash: round2(value), updatedAt: timestamp() };
  await savePaper(state, homeDir);
  return { account: state.account, positions: state.positions, trades: state.trades };
}

/** @param {string} [homeDir] */
export async function paperSnapshot(homeDir = defaultHomeDir()) {
  const state = await loadPaper(homeDir);
  return {
    account: { ...state.account, totalAssets: totalAssets(state.account, state.positions) },
    positions: state.positions,
    trades: state.trades,
  };
}
