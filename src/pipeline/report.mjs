/**
 * Decision report: schema v1 assembly, Markdown rendering, atomic storage and
 * `index.json` maintenance.
 *
 * Contract: `<DOCS>/design/report.md` (schemaVersion 1.0, id rules, storage).
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const SCHEMA_VERSION = '1.0';

/** @returns {string} `$DSH_TRADINGAGENTS_HOME` wins (tests / self-hosting). */
export function defaultHomeDir() {
  return process.env.DSH_TRADINGAGENTS_HOME || join(homedir(), '.dsh', 'tradingagents');
}

/** @param {string} tradeDate @param {string} symbol @param {string} tier */
export function baseReportId(tradeDate, symbol, tier) {
  return `${tradeDate.replace(/-/g, '')}-${symbol}-${tier}`;
}

/**
 * @param {{
 *   symbol: string, name: string|null, tradeDate: string, tier: string,
 *   models: { analysts: any, judge: any, usage: any },
 *   snapshot: any, intent: any,
 *   roles: Array<{ id: string, title: string, verdict: any, reportMd: string }>,
 *   debate: { rounds: number, bull: string[], bear: string[] },
 *   risk: any, verdict: any, gaps: string[],
 *   generatedAt: string,
 * }} input
 * @returns {any} decision report (schema v1)
 */
export function buildReport(input) {
  const categories = {};
  for (const [key, entry] of Object.entries(input.snapshot.categories ?? {})) {
    categories[key] = {
      status: entry.status,
      source: entry.source ?? null,
      fetchedAt: entry.fetchedAt ?? null,
      asOf: entry.asOf ?? null,
      warnings: entry.warnings ?? [],
      attempts: (entry.attempts ?? []).map((attempt) => ({
        source: attempt.source ?? null,
        ok: Boolean(attempt.ok),
        ms: attempt.ms ?? 0,
        ...(attempt.error ? { error: attempt.error } : {}),
      })),
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: null, // filled by saveReport (collision handling)
    symbol: input.symbol,
    name: input.name ?? null,
    tradeDate: input.tradeDate,
    generatedAt: input.generatedAt,
    tier: input.tier,
    intent: input.intent ?? null,
    models: input.models,
    data: {
      snapshotAt: input.snapshot.snapshotAt ?? null,
      missing: input.snapshot.missing ?? [],
      categories,
    },
    verdict: input.verdict,
    roles: input.roles,
    debate: input.debate,
    risk: input.risk ?? { aggressive: null, conservative: null, neutral: null, managerFeedback: null },
    gaps: input.gaps,
  };
}

/** @param {any} report */
export function renderMarkdown(report) {
  const tierZh = { quick: '快速', standard: '标准', deep: '深度' }[report.tier] ?? report.tier;
  const directionZh = { bullish: '看多', bearish: '看空', neutral: '中性' }[report.verdict.direction] ?? report.verdict.direction;
  const range = report.verdict.entryRange ? `${report.verdict.entryRange[0]} – ${report.verdict.entryRange[1]} 元` : '—';
  const lines = [];
  lines.push(`# ${report.name ?? ''}（${report.symbol}）· ${report.tradeDate} · ${tierZh}档`);
  lines.push('');
  lines.push(`生成时间：${report.generatedAt}　模型：${report.models.analysts.model}（分析师）/ ${report.models.judge.model}（拍板）`);
  lines.push('');
  lines.push('## 决策卡');
  lines.push('');
  lines.push(`- 方向：**${directionZh}**`);
  lines.push(`- 置信度：${report.verdict.confidence}/100`);
  lines.push(`- 建议仓位：${report.verdict.positionPct}%`);
  lines.push(`- 入场区间：${range}`);
  lines.push(`- 止损：${report.verdict.stopLoss ?? '—'} 元`);
  lines.push(`- 目标：${report.verdict.target ?? '—'} 元`);
  lines.push(`- 理由：${report.verdict.oneLineReason ?? '—'}`);
  lines.push('');
  lines.push('> 仅供研究参考，不构成投资建议。');
  lines.push('');
  lines.push('## 数据与缺口（来源溯源）');
  lines.push('');
  lines.push(`缺失类别：${report.data.missing.length ? report.data.missing.join('、') : '无'}；以下逐类给出 source / fetchedAt / asOf / warnings / 尝试链。`);
  lines.push('');
  for (const [category, entry] of Object.entries(report.data.categories ?? {})) {
    const attempts = (entry.attempts ?? []).map((attempt) => `${attempt.source ?? '(none)'}${attempt.ok ? ' ✓' : ` ✗ ${attempt.error?.code ?? 'ERR'}`}`).join(' → ');
    const warnings = (entry.warnings ?? []).join('；');
    lines.push(`- **${category}**：status=${entry.status ?? '—'}，source=${entry.source ?? '—'}，fetchedAt=${entry.fetchedAt ?? '—'}，asOf=${entry.asOf ?? '—'}${warnings ? `，warnings：${warnings}` : ''}，尝试链 ${attempts || '—'}`);
  }
  if (report.gaps.length) {
    lines.push('');
    lines.push(`角色级提示：${report.gaps.join('；')}`);
  }
  lines.push('');
  lines.push('## 多空辩论（左右对照）');
  lines.push('');
  lines.push('| 轮次 | 多头 | 空头 |');
  lines.push('|---|---|---|');
  const DIRECTIONS_ZH = { bullish: '看多', bearish: '看空', neutral: '中性' };
  for (let round = 0; round < report.debate.rounds; round += 1) {
    const bullText = report.debate.bull[round]?.text ?? report.debate.bull[round] ?? '';
    const bearText = report.debate.bear[round]?.text ?? report.debate.bear[round] ?? '';
    lines.push(`| ${round + 1} | ${escapeCell(bullText)} | ${escapeCell(bearText)} |`);
  }
  lines.push('');
  lines.push('## 角色面板');
  lines.push('');
  const toDirectionZh = (value) => DIRECTIONS_ZH[value] ?? value;
  for (const role of report.roles) {
    lines.push(`<details><summary>${role.title}${role.verdict ? ` · ${toDirectionZh(role.verdict.direction)} ${role.verdict.confidence}` : ''}</summary>`);
    lines.push('');
    lines.push(role.reportMd || '（无正文）');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  lines.push(`---\nreportId: ${report.id ?? '(pending)'} · schemaVersion ${report.schemaVersion} · tier ${report.tier}`);
  return `${lines.join('\n')}\n`;
}

/** @param {string} text */
function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 500);
}

/** @param {string} file @param {string} content */
async function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

/** @param {string} homeDir */
export function reportsDir(homeDir = defaultHomeDir()) {
  return join(homeDir, 'reports');
}

/**
 * @param {any} report
 * @param {{ homeDir?: string, maxIndexItems?: number }} [options]
 * @returns {Promise<{ id: string, files: { md: string, json: string }, index: string }>}
 */
export async function saveReport(report, { homeDir = defaultHomeDir(), maxIndexItems = 200 } = {}) {
  const dir = reportsDir(homeDir);
  await mkdir(dir, { recursive: true });
  const base = baseReportId(report.tradeDate, report.symbol, report.tier);
  let id = base;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    try {
      await readFile(join(dir, `${id}.decision.json`), 'utf8');
      id = `${base}-${attempt}`;
    } catch {
      break;
    }
  }
  report.id = id;
  const jsonFile = join(dir, `${id}.decision.json`);
  const mdFile = join(dir, `${id}.md`);
  await writeAtomic(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
  await writeAtomic(mdFile, renderMarkdown(report));

  const indexFile = join(homeDir, 'index.json');
  const index = await loadIndex(homeDir);
  const entry = {
    id,
    schemaVersion: report.schemaVersion,
    symbol: report.symbol,
    name: report.name,
    tradeDate: report.tradeDate,
    tier: report.tier,
    generatedAt: report.generatedAt,
    verdict: {
      direction: report.verdict.direction,
      confidence: report.verdict.confidence,
      positionPct: report.verdict.positionPct,
    },
  };
  index.items = [entry, ...index.items.filter((item) => item.id !== id)].slice(0, maxIndexItems);
  await writeAtomic(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  return { id, files: { md: mdFile, json: jsonFile }, index: indexFile };
}

/**
 * Load `index.json`; rebuild by scanning `reports/` when missing or corrupt.
 * @param {string} homeDir
 */
export async function loadIndex(homeDir = defaultHomeDir()) {
  const indexFile = join(homeDir, 'index.json');
  try {
    const parsed = JSON.parse(await readFile(indexFile, 'utf8'));
    if (Array.isArray(parsed?.items)) return { version: 1, items: parsed.items };
  } catch {
    // fall through to rebuild
  }
  return rebuildIndex(homeDir);
}

/** @param {string} homeDir */
export async function rebuildIndex(homeDir = defaultHomeDir()) {
  const dir = reportsDir(homeDir);
  /** @type {any[]} */
  const items = [];
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return { version: 1, items: [] };
  }
  for (const file of files) {
    if (!file.endsWith('.decision.json')) continue;
    try {
      const report = JSON.parse(await readFile(join(dir, file), 'utf8'));
      // Keep non-1.0 reports listed (summary + hint on open) instead of hiding them.
      items.push({
        id: report.id ?? file.replace(/\.decision\.json$/, ''),
        schemaVersion: report.schemaVersion ?? 'unknown',
        symbol: report.symbol,
        name: report.name,
        tradeDate: report.tradeDate,
        tier: report.tier,
        generatedAt: report.generatedAt,
        verdict: {
          direction: report.verdict?.direction ?? null,
          confidence: report.verdict?.confidence ?? null,
          positionPct: report.verdict?.positionPct ?? null,
        },
      });
    } catch {
      // skip unreadable reports; never fabricate an entry
    }
  }
  items.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  const index = { version: 1, items };
  await mkdir(homeDir, { recursive: true });
  await writeAtomic(join(homeDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
