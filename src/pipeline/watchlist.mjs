/**
 * Watchlist persistence: `~/.dsh/tradingagents/watchlist.json` = `{ symbols: string[] }`.
 * Contract: `<DOCS>/design/pipeline-runtime.md` §2/§7, ui-panel §3.1 (Q17).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSymbol } from '../data/normalize.mjs';
import { defaultHomeDir } from './report.mjs';

/** @param {string} homeDir */
function watchlistFile(homeDir) {
  return join(homeDir, 'watchlist.json');
}

/** @param {string} homeDir */
export async function loadWatchlist(homeDir = defaultHomeDir()) {
  try {
    const parsed = JSON.parse(await readFile(watchlistFile(homeDir), 'utf8'));
    if (Array.isArray(parsed?.symbols)) return { symbols: parsed.symbols.filter((symbol) => /^\d{6}$/.test(String(symbol))) };
  } catch {
    // missing/corrupt: treat as empty, never fabricate entries
  }
  return { symbols: [] };
}

/** @param {{ homeDir?: string }} [options] */
async function saveWatchlist(symbols, homeDir) {
  await mkdir(homeDir, { recursive: true });
  const file = watchlistFile(homeDir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify({ symbols }, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * @param {{ homeDir?: string, add?: string[], remove?: string[] }} input
 * @returns {Promise<{ symbols: string[] }>}
 */
export async function updateWatchlist({ homeDir = defaultHomeDir(), add = [], remove = [] } = {}) {
  const state = await loadWatchlist(homeDir);
  const removed = new Set((remove ?? []).map((symbol) => parseSymbol(symbol).symbol));
  const symbols = state.symbols.filter((symbol) => !removed.has(symbol));
  for (const raw of add ?? []) {
    const symbol = parseSymbol(raw).symbol;
    if (!symbols.includes(symbol)) symbols.push(symbol);
  }
  await saveWatchlist(symbols, homeDir);
  return { symbols };
}
