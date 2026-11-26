#!/usr/bin/env node
/**
 * Zero-dependency schema validator for `.decision.json` (schemaVersion 1.0).
 *
 *   node scripts/check-report.mjs <file.json | reports-dir>
 *
 * Exit 0 when every file validates; 1 otherwise (prints each problem).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIRECTIONS = new Set(['bullish', 'bearish', 'neutral']);
const TIERS = new Set(['quick', 'standard', 'deep']);
const STATUSES = new Set(['ok', 'degraded', 'missing']);
const CATEGORY_KEYS = ['quote', 'klines', 'fundamentals', 'news', 'moneyflow', 'dragon_tiger', 'sector'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isNullableString = (value) => value === null || typeof value === 'string';
const isInteger = (value, min = 0, max = 100) => Number.isInteger(value) && value >= min && value <= max;
const isNullableNumber = (value) => value === null || Number.isFinite(value);

/**
 * @param {any} report
 * @returns {string[]} problems
 */
export function validateReport(report) {
  const problems = [];
  const push = (message) => problems.push(message);
  if (!isObject(report)) return ['report 不是对象'];

  if (report.schemaVersion !== '1.0') push('schemaVersion 必须为 "1.0"');
  const ALLOWED_TOP_LEVEL = new Set(['schemaVersion', 'id', 'symbol', 'name', 'tradeDate', 'generatedAt', 'tier', 'intent', 'models', 'data', 'verdict', 'roles', 'debate', 'risk', 'gaps']);
  for (const key of Object.keys(report)) if (!ALLOWED_TOP_LEVEL.has(key)) push(`未知顶层字段：${key}`);
  if (!isString(report.id) || !/^\d{8}-\d{6}-(quick|standard|deep)(-\d+)?$/.test(report.id)) push(`id 非法：${String(report.id)}`);
  if (!isString(report.symbol) || !/^\d{6}$/.test(report.symbol)) push('symbol 必须是 6 位数字');
  if (!isNullableString(report.name)) push('name 必须是字符串或 null');
  if (!isString(report.tradeDate) || !/^\d{4}-\d{2}-\d{2}$/.test(report.tradeDate)) push('tradeDate 必须是 YYYY-MM-DD');
  if (!isString(report.generatedAt) || Number.isNaN(Date.parse(report.generatedAt))) push('generatedAt 必须是 ISO 时间');
  if (!TIERS.has(report.tier)) push('tier 非法');

  if (report.intent !== null) {
    if (!isObject(report.intent)) push('intent 必须是 null 或对象');
    else if (!isNullableString(report.intent.userView) || !Array.isArray(report.intent.focusQuestions)) push('intent 字段非法');
  }

  if (!isObject(report.models)) push('models 缺失');
  else {
    for (const slot of ['analysts', 'judge']) {
      const entry = report.models[slot];
      if (!isObject(entry) || !isString(entry.provider) || !isString(entry.model) || !isString(entry.effort)) push(`models.${slot} 非法`);
    }
    const usage = report.models.usage;
    if (!isObject(usage) || !isInteger(usage.inputTokens, 0, Number.MAX_SAFE_INTEGER) || !isInteger(usage.outputTokens, 0, Number.MAX_SAFE_INTEGER) || !isInteger(usage.calls, 0, Number.MAX_SAFE_INTEGER)) {
      push('models.usage 非法');
    }
  }

  if (!isObject(report.data)) push('data 缺失');
  else {
    if (!isNullableString(report.data.snapshotAt)) push('data.snapshotAt 非法');
    if (!Array.isArray(report.data.missing) || report.data.missing.some((item) => !isString(item))) push('data.missing 必须是字符串数组');
    if (!isObject(report.data.categories)) push('data.categories 缺失');
    else {
      for (const category of CATEGORY_KEYS) {
        const entry = report.data.categories[category];
        if (!isObject(entry)) { push(`data.categories.${category} 缺失`); continue; }
        if (!STATUSES.has(entry.status)) push(`data.categories.${category}.status 非法`);
        if (!isNullableString(entry.source)) push(`data.categories.${category}.source 非法`);
        if (!isNullableString(entry.fetchedAt)) push(`data.categories.${category}.fetchedAt 非法`);
        if (!isNullableString(entry.asOf)) push(`data.categories.${category}.asOf 非法`);
        if (!Array.isArray(entry.warnings) || entry.warnings.some((item) => !isString(item))) push(`data.categories.${category}.warnings 非法`);
        if (!Array.isArray(entry.attempts)) push(`data.categories.${category}.attempts 缺失`);
        else for (const attempt of entry.attempts) {
          if (!isObject(attempt) || !isNullableString(attempt.source) || typeof attempt.ok !== 'boolean' || !Number.isFinite(attempt.ms)) push(`data.categories.${category}.attempts 条目非法`);
          if (attempt?.error !== undefined && (!isObject(attempt.error) || !isString(attempt.error.code) || !isString(attempt.error.message))) push(`data.categories.${category}.attempts.error 非法`);
        }
      }
    }
  }

  const verdict = report.verdict;
  if (!isObject(verdict)) push('verdict 缺失');
  else {
    if (!DIRECTIONS.has(verdict.direction)) push('verdict.direction 非法');
    if (!isInteger(verdict.confidence)) push('verdict.confidence 必须是 0–100 整数');
    if (!isInteger(verdict.positionPct)) push('verdict.positionPct 必须是 0–100 整数');
    if (verdict.entryRange !== null) {
      if (!Array.isArray(verdict.entryRange) || verdict.entryRange.length !== 2 || !verdict.entryRange.every((item) => Number.isFinite(item)) || verdict.entryRange[0] > verdict.entryRange[1]) {
        push('verdict.entryRange 必须是 [low, high]');
      }
    }
    if (!isNullableNumber(verdict.stopLoss)) push('verdict.stopLoss 非法');
    if (!isNullableNumber(verdict.target)) push('verdict.target 非法');
    if (!isNullableString(verdict.oneLineReason)) push('verdict.oneLineReason 非法');
  }

  if (!Array.isArray(report.roles) || report.roles.length === 0) push('roles 必须是非空数组');
  else for (const role of report.roles) {
    if (!isObject(role) || !isString(role.id) || !isString(role.title) || !isString(role.reportMd)) push('roles 条目非法');
    if (role?.verdict !== null && role?.verdict !== undefined) {
      const verdict = role.verdict;
      if (!isObject(verdict) || !DIRECTIONS.has(verdict.direction) || !isInteger(verdict.confidence) || !isString(verdict.reason)) {
        push(`roles[${role.id}] verdict 非法（需 direction/confidence/reason）`);
      }
      for (const key of Object.keys(verdict ?? {})) {
        if (!['direction', 'confidence', 'reason'].includes(key)) push(`roles[${role.id}] verdict 未知字段：${key}`);
      }
    }
  }

  if (!isObject(report.debate) || !Number.isInteger(report.debate.rounds) || report.debate.rounds < 1 || !Array.isArray(report.debate.bull) || !Array.isArray(report.debate.bear)) {
    push('debate 非法');
  } else {
    if (report.debate.bull.length !== report.debate.rounds) push('debate.bull 长度应等于 rounds');
    if (report.debate.bear.length !== report.debate.rounds) push('debate.bear 长度应等于 rounds');
    for (const side of ['bull', 'bear']) {
      report.debate[side].forEach((entry, index) => {
        if (!isObject(entry) || entry.round !== index + 1 || !isString(entry.text)) push(`debate.${side}[${index}] 必须是 {round:${index + 1}, text}`);
      });
    }
  }

  if (!isObject(report.risk)) push('risk 缺失');
  else for (const key of ['aggressive', 'conservative', 'neutral', 'managerFeedback']) {
    if (!isNullableString(report.risk[key])) push(`risk.${key} 非法`);
  }

  if (!Array.isArray(report.gaps) || report.gaps.some((item) => !isString(item))) push('gaps 必须是字符串数组');
  return problems;
}

/** @param {string} path */
async function filesFor(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const entries = await readdir(path);
  return entries.filter((name) => name.endsWith('.decision.json')).map((name) => join(path, name));
}

/** @param {string[]} argv */
async function main(argv) {
  const target = argv[0];
  if (!target) {
    console.error('用法: node scripts/check-report.mjs <file.json | reports-dir>');
    process.exit(64);
  }
  const files = await filesFor(target);
  if (files.length === 0) {
    console.error(`check-report: 没有找到 .decision.json（${target}）`);
    process.exit(1);
  }
  let failed = 0;
  for (const file of files) {
    const problems = validateReport(JSON.parse(await readFile(file, 'utf8')));
    if (problems.length === 0) {
      console.log(`ok - ${file}`);
    } else {
      failed += 1;
      console.error(`FAIL - ${file}`);
      for (const problem of problems) console.error(`  - ${problem}`);
    }
  }
  if (failed > 0) {
    console.error(`check-report: FAIL — ${failed}/${files.length} 份报告不符合 schema v1`);
    process.exit(1);
  }
  console.log(`check-report: OK — ${files.length} 份报告符合 schema v1`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`check-report: ERROR — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
