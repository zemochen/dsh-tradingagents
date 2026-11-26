#!/usr/bin/env node
/**
 * One-time migration: bring pre-fix v1 artifacts in line with the frozen schema
 * (`design/report.md` §2) and re-render their Markdown from the JSON.
 *
 * Fixes applied when needed:
 *   - debate.bull/bear: string[] -> [{round, text}]
 *   - roles[].verdict: {direction, confidence, oneLineReason} -> {direction, confidence, reason}
 *   - drop the non-schema top-level `plan`
 *
 * Backs up every changed `.decision.json` to `<home>/migration-backup-<ts>/` and
 * rebuilds `index.json`. Idempotent: a second run reports zero changes.
 *
 *   node scripts/migrate-reports.mjs [homeDir]
 */
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultHomeDir, rebuildIndex, renderMarkdown, reportsDir } from '../src/pipeline/report.mjs';

const homeDir = process.argv[2] ?? defaultHomeDir();
const dir = reportsDir(homeDir);
const backupDir = join(homeDir, `migration-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);

/** @param {any[]} list @returns {any[]} */
function normalizeDebate(list) {
  return (list ?? []).map((entry, index) => (
    typeof entry === 'string' ? { round: index + 1, text: entry } : { round: entry?.round ?? index + 1, text: String(entry?.text ?? '') }
  ));
}

/** @param {any} verdict */
function normalizeRoleVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object') return verdict ?? null;
  const { direction, confidence, reason, oneLineReason } = verdict;
  return { direction, confidence, reason: reason ?? oneLineReason ?? '' };
}

/** @param {any} report @returns {boolean} */
function migrate(report) {
  let changed = false;
  for (const side of ['bull', 'bear']) {
    const list = report?.debate?.[side];
    if (Array.isArray(list) && list.some((entry) => typeof entry === 'string')) {
      report.debate[side] = normalizeDebate(list);
      changed = true;
    }
  }
  for (const role of report.roles ?? []) {
    if (role?.verdict && Object.prototype.hasOwnProperty.call(role.verdict, 'oneLineReason')) {
      role.verdict = normalizeRoleVerdict(role.verdict);
      changed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(report, 'plan')) {
    delete report.plan;
    changed = true;
  }
  return changed;
}

const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.decision.json'));
let migrated = 0;
for (const file of files) {
  const path = join(dir, file);
  let report;
  try {
    report = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    console.warn(`skip unreadable: ${file}`);
    continue;
  }
  if (!migrate(report)) continue;
  await mkdir(backupDir, { recursive: true });
  await copyFile(path, join(backupDir, file));
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
  await writeFile(join(dir, file.replace(/\.decision\.json$/, '.md')), renderMarkdown(report), 'utf8');
  migrated += 1;
  console.log(`migrated ${file}`);
}

const index = await rebuildIndex(homeDir);
console.log(`migrate-reports: ${migrated}/${files.length} 份已迁移，index 共 ${index.items.length} 条`);
if (migrated > 0) console.log(`backup: ${backupDir}`);
