#!/usr/bin/env node
/**
 * Phase 1 runtime tests (no network, no real LLM, no fake market data):
 *   - Config Standard Schema defaults / validation
 *   - run registry: single-active, ordered events, replay, terminal state
 *   - HTTP/SSE skeleton through the registered route resource
 *   - LLM wrapper: usage, retry, budget, concurrency, timeout/cancel
 *
 * Usage: node scripts/test-pipeline.mjs
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Config, normalizeConfig } from '../src/pipeline/config.mjs';
import { RunRegistry } from '../src/pipeline/runs.mjs';
import { createLlmRunner, BudgetExceededError, LlmCallError } from '../src/pipeline/llm.mjs';
import { runAnalysis } from '../src/pipeline/index.mjs';
import { validateReport } from './check-report.mjs';
import { apply, createRuntime } from '../index.js';

const execFileAsync = promisify(execFile);

let assertions = 0;
async function check(name, fn) {
  await fn();
  assertions += 1;
  console.log(`ok - ${name}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ Config */
await check('Config 默认值（Standard Schema）', () => {
  const result = Config['~standard'].validate({});
  assert.ok('value' in result, '默认配置应通过');
  assert.equal(result.value.analysts.model, 'deepseek-v4.1-flash');
  assert.equal(result.value.analysts.effort, 'low');
  assert.equal(result.value.judge.effort, 'high');
  assert.equal(result.value.fees.commissionRate, 0.0003);
  assert.equal(result.value.fees.minCommission, 5);
  const partial = Config['~standard'].validate({ analysts: { effort: 'medium' } });
  assert.equal(partial.value.analysts.effort, 'medium');
  assert.equal(partial.value.judge.effort, 'high');
});

await check('Config 非法值返回 issues', () => {
  const bad = Config['~standard'].validate({ analysts: { effort: 'ultra' }, fees: { commissionRate: 2 } });
  assert.ok('issues' in bad);
  assert.ok(bad.issues.length >= 2);
  assert.equal(normalizeConfig(undefined).issues.length, 0);
});

/* ------------------------------------------------------------ run registry */
await check('RunRegistry：单活跃 run / 事件序号 / 回放 / 取消', () => {
  const runs = new RunRegistry();
  const { id } = runs.create({ symbol: '600519', tier: 'quick' });
  assert.throws(() => runs.create({ symbol: '000001', tier: 'quick' }), (error) => error.code === 'RUN_ACTIVE');
  runs.emit(id, { type: 'phase', phase: 'validate', message: 'a' });
  runs.emit(id, { type: 'phase', phase: 'snapshot', index: 1, total: 2, message: 'b' });
  const events = runs.eventsSince(id, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].runId, id);
  assert.ok(events[0].at.endsWith('+08:00'));
  runs.cancel(id);
  assert.equal(runs.get(id).status, 'cancelled');
  runs.dispose();
  const fresh = new RunRegistry();
  assert.ok(fresh.create({ symbol: '600519', tier: 'quick' }).id);
  fresh.dispose();
});

/* ------------------------------------------------------------ HTTP / SSE */
const captured = { route: null };
const fakeCtx = {
  get(name) {
    if (name === 'llm') return { stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })() };
    return undefined;
  },
  inject(names, callback) {
    assert.ok(names.includes('webServer'));
    callback({
      effect(fn) {
        const dispose = fn();
        assert.equal(typeof dispose, 'function');
        return dispose;
      },
      webServer: {
        register(route) {
          captured.route = route;
          return () => {};
        },
      },
    });
  },
};

const fakeLlm = {
  stream: () => (async function* () {
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })(),
};
const runtime = createRuntime({ llm: fakeLlm, config: {} });

await check('apply() 注册 prefix handler 路由且暴露 Config', () => {
  apply(fakeCtx, {});
  assert.ok(captured.route);
  assert.equal(captured.route.kind, 'prefix');
  assert.equal(captured.route.path, '/dsh-tradingagents/api');
  assert.equal(typeof captured.route.handler, 'function', 'POST + SSE need the node handler form (resource is GET/HEAD only)');
  assert.ok(Config['~standard']);
});

const request = (path, init) => runtime.handleFetch(new Request(`http://127.0.0.1/dsh-tradingagents/api${path}`, init));
const postJson = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

await check('POST /analyze：输入校验（422）', async () => {
  const badSymbol = await postJson('/analyze', { symbol: 'abc' });
  assert.equal(badSymbol.status, 422);
  assert.equal((await badSymbol.json()).error, 'INVALID_SYMBOL');
  const badTier = await postJson('/analyze', { symbol: '600519', tier: 'ultra' });
  assert.equal(badTier.status, 422);
  assert.equal((await badTier.json()).error, 'INVALID_TIER');
  const badJson = await request('/analyze', { method: 'POST', body: '{' });
  assert.equal(badJson.status, 400);
});

await check('POST /analyze：启动 run + SSE 事件流', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch disabled in tests'); };
  try {
    const ok = await postJson('/analyze', { symbol: '600519', tier: 'quick' });
    assert.equal(ok.status, 202);
    const { runId } = await ok.json();
    assert.ok(runId.startsWith('run-'));
    // Pipeline fails fast (calendar fetch disabled) → terminal error event.
    await delay(80);
    const events = await request(`/runs/${runId}/events`);
    assert.equal(events.status, 200);
    assert.match(events.headers.get('content-type'), /text\/event-stream/);
    const text = await events.text();
    assert.match(text, /"type":"run"/);
    assert.match(text, /"type":"error"/);
    assert.match(text, /"seq":0/);
    const standard = await postJson('/analyze', { symbol: '600519', tier: 'standard' });
    assert.equal(standard.status, 202, 'standard tier is implemented (Phase 4)');
    assert.ok((await standard.json()).runId);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await check('GET /runs/:id/events：未知 run → 410；reports → 200；未知路由 → 404', () => withTempDir(async (dir) => {
  const previous = process.env.DSH_TRADINGAGENTS_HOME;
  process.env.DSH_TRADINGAGENTS_HOME = dir;
  try {
    const gone = await request('/runs/nope/events');
    assert.equal(gone.status, 410);
    assert.equal((await gone.json()).error, 'RUN_GONE');
    const reports = await request('/reports');
    assert.equal(reports.status, 200);
    assert.deepEqual((await reports.json()).items, []);
    const limited = await request('/reports?limit=1');
    assert.equal(limited.status, 200);
    assert.deepEqual((await limited.json()).items, []);
    const unknown = await request('/nope');
    assert.equal(unknown.status, 404);
  } finally {
    if (previous === undefined) delete process.env.DSH_TRADINGAGENTS_HOME;
    else process.env.DSH_TRADINGAGENTS_HOME = previous;
  }
}));

/* --------------------------------------------------------------- LLM wrapper */
function generator(chunks) {
  return async function* stream() {
    for (const chunk of chunks) yield chunk;
  };
}
const okChunks = [
  { type: 'text-delta', text: 'hello' },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
  { type: 'finish', reason: { kind: 'stop' } },
];
const testConfig = {
  analysts: { provider: 'p', model: 'm-low', effort: 'low' },
  judge: { provider: 'p', model: 'm-high', effort: 'high' },
};

await check('LLM：文本/usage 累计 + slot 选择', async () => {
  const seen = [];
  const runner = createLlmRunner({
    llm: { stream(options) { seen.push(options); return generator(okChunks)(); } },
    config: testConfig,
    sessionId: 'run-test-1',
  });
  const result = await runner.call({ slot: 'judge', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.text, 'hello');
  assert.ok(Array.isArray(seen[0].messages[0].content), 'messages must carry ContentBlock[]');
  assert.equal(seen[0].messages[0].content[0].type, 'text');
  assert.deepEqual(runner.usage(), { inputTokens: 10, outputTokens: 5, calls: 1 });
  assert.equal(seen[0].model, 'm-high');
  assert.equal(seen[0].reasoningEffort, 'high');
  assert.equal(seen[0].sessionId, 'run-test-1', 'opencode-go needs GenerateOptions.sessionId (x-opencode-session)');
});

await check('LLM：瞬时失败重试 1 次后成功', async () => {
  let calls = 0;
  const runner = createLlmRunner({
    llm: {
      stream() {
        calls += 1;
        if (calls === 1) throw new LlmCallError('SOURCE_HTTP', 'boom', { status: 500 });
        return generator(okChunks)();
      },
    },
    config: testConfig,
    retryDelayMs: 0,
  });
  const result = await runner.call({ messages: [] });
  assert.equal(result.text, 'hello');
  assert.equal(calls, 2);
});

await check('LLM：预算超限（BUDGET_EXCEEDED）不重试', async () => {
  const runner = createLlmRunner({
    llm: { stream: () => generator(okChunks)() },
    config: testConfig,
    budgetTokens: 12,
    retryDelayMs: 0,
  });
  await assert.rejects(() => runner.call({ messages: [] }), (error) => error instanceof BudgetExceededError);
});

await check('LLM：并发上限生效', async () => {
  let active = 0;
  let maxActive = 0;
  const runner = createLlmRunner({
    llm: {
      async *stream() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(15);
        active -= 1;
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    },
    config: testConfig,
    concurrency: 2,
  });
  await Promise.all(Array.from({ length: 4 }, () => runner.call({ messages: [] })));
  assert.equal(maxActive, 2);
});

await check('LLM：超时 → SOURCE_TIMEOUT；外部取消 → CANCELLED', async () => {
  const hangingStream = async function* stream({ signal } = {}) {
    await new Promise((resolve, reject) => {
      if (signal?.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      else signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const timeoutRunner = createLlmRunner({
    llm: { stream: (options) => hangingStream(options) },
    config: testConfig,
    timeoutMs: 15,
    retries: 0,
  });
  await assert.rejects(() => timeoutRunner.call({ messages: [] }), (error) => error.code === 'SOURCE_TIMEOUT');

  const controller = new AbortController();
  const cancelRunner = createLlmRunner({
    llm: { stream: (options) => hangingStream(options) },
    config: testConfig,
    timeoutMs: 5_000,
    retries: 0,
  });
  const pending = cancelRunner.call({ messages: [], signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, (error) => error.code === 'CANCELLED');
});

/* ------------------------------------------------------- Phase 2: quick tier */
const VERDICT = { direction: 'bullish', confidence: 60, positionPct: 10, entryRange: [100, 110], stopLoss: 95, target: 120, oneLineReason: 'stub' };

function verdictText() {
  return `分析正文（stub）。\n\n\`\`\`json\n${JSON.stringify(VERDICT, null, 2)}\n\`\`\``;
}

/** Stub LLM: never fabricates market data, only scripted model text. */
function stubLlm({ failOn = [], noVerdictFirst = false, calls } = {}) {
  return {
    stream(options) {
      const system = String(options.system ?? '');
      if (calls) calls.count += 1;
      if (failOn.some((needle) => system.includes(needle))) throw new LlmCallError('LLM_CALL_FAILED', 'stub 角色失败');
      const isRepair = system.includes('上一次输出');
      const text = noVerdictFirst && !isRepair ? '分析正文但没有 json 块。' : verdictText();
      return (async function* stream() {
        yield { type: 'text-delta', text };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
}

function category(entry, source = 'eastmoney') {
  return {
    status: 'ok', source, fetchedAt: '2026-11-22T09:30:00+08:00', asOf: '2026-11-20',
    warnings: [], attempts: [{ source, ok: true, ms: 10 }], data: entry,
  };
}

function snapshotStub() {
  return {
    symbol: '600519',
    exchange: 'sh',
    tradeDate: '2026-11-20',
    snapshotAt: '2026-11-22T09:30:00+08:00',
    missing: ['dragon_tiger', 'sector'],
    categories: {
      quote: category({ name: '贵州茅台', price: 1485.75 }),
      klines: category({ bars: [{ date: '2026-11-20', close: 1485.75 }] }),
      fundamentals: category({ valuation: { peTtm: 22 }, financials: { reportDate: '2026-09-30' } }),
      news: category({ items: [] }),
      moneyflow: category({ bars: [{ date: '2026-11-20', mainNet: 1 }] }),
      dragon_tiger: { status: 'missing', source: null, fetchedAt: null, asOf: null, warnings: [], attempts: [{ source: '(none)', ok: false, ms: 0, error: { code: 'UNSUPPORTED', message: '未实现' } }], data: null },
      sector: { status: 'missing', source: null, fetchedAt: null, asOf: null, warnings: [], attempts: [{ source: '(none)', ok: false, ms: 0, error: { code: 'UNSUPPORTED', message: '未实现' } }], data: null },
    },
  };
}

function dataStub(snapshot) {
  return { fetchSnapshot: async () => snapshot };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ta-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

await check('快速档：stub LLM 跑通 → 两份文件 + schema 通过 + index', () => withTempDir(async (dir) => {
  const events = [];
  const result = await runAnalysis(
    { symbol: '600519', tradeDate: '2026-11-20', tier: 'quick', onEvent: (event) => events.push(event) },
    { llm: stubLlm(), data: dataStub(snapshotStub()), homeDir: dir },
  );
  assert.match(result.id, /^20261120-600519-quick$/);
  const json = JSON.parse(await readFile(result.files.json, 'utf8'));
  assert.deepEqual(validateReport(json), []);
  assert.equal(json.data.missing.includes('quote'), false);
  assert.equal(json.roles.length, 8, 'quick 角色条目 = 3 分析师 + 多空 + 经理 + 提案 + 终审');
  assert.equal(json.roles.filter((role) => role.id === 'trader').length, 1);
  assert.ok(json.roles.some((role) => role.id === 'trader-proposal'));
  assert.deepEqual(Object.keys(json.roles[0].verdict).sort(), ['confidence', 'direction', 'reason']);
  assert.equal(json.debate.rounds, 1);
  assert.equal(json.debate.bull[0].round, 1);
  assert.equal(typeof json.debate.bull[0].text, 'string');
  assert.equal('plan' in json, false, 'plan 不在冻结 schema 内');
  assert.equal(json.models.usage.calls, 8, '快速档 8 次调用（3+2+1+1+1）');
  const md = await readFile(result.files.md, 'utf8');
  assert.match(md, /仅供研究参考，不构成投资建议/);
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  assert.equal(index.items.length, 1);
  assert.equal(index.items[0].id, result.id);
  assert.ok(events.some((event) => event.phase === 'analysts'));
  assert.ok(events.some((event) => event.phase === 'report'));
  const { stdout } = await execFileAsync(process.execPath, [join(process.cwd(), 'scripts/check-report.mjs'), join(dir, 'reports')]);
  assert.match(stdout, /check-report: OK/);
}));

await check('快速档：省略 tradeDate 时用数据层解析出的日期落盘', () => withTempDir(async (dir) => {
  const result = await runAnalysis(
    { symbol: '600519', tier: 'quick' },
    { llm: stubLlm(), data: dataStub(snapshotStub()), homeDir: dir },
  );
  const json = JSON.parse(await readFile(result.files.json, 'utf8'));
  assert.equal(json.tradeDate, '2026-11-20');
  assert.match(result.id, /^20261120-600519-quick/);
  assert.deepEqual(validateReport(json), []);
}));

await check('快速档：quote 致命缺失 → QUOTE_UNAVAILABLE + attempts + 不落盘', () => withTempDir(async (dir) => {
  const snapshot = snapshotStub();
  snapshot.missing = ['quote'];
  snapshot.fatal = { category: 'quote', reason: { code: 'SOURCE_TIMEOUT', message: '行情源超时' } };
  snapshot.categories.quote = {
    status: 'missing', source: null, fetchedAt: null, asOf: null, warnings: [],
    attempts: [{ source: 'eastmoney', ok: false, ms: 10, error: { code: 'SOURCE_TIMEOUT', message: '超时' } }],
    data: null,
  };
  await assert.rejects(
    () => runAnalysis({ symbol: '600519', tradeDate: '2026-11-20', tier: 'quick' }, { llm: stubLlm(), data: dataStub(snapshot), homeDir: dir }),
    (error) => error.code === 'QUOTE_UNAVAILABLE' && error.data.attempts.length === 1,
  );
  const entries = await readdir(dir).catch(() => []);
  assert.equal(entries.some((name) => name.endsWith('.decision.json')), false);
  assert.equal(entries.includes('reports'), false);
}));

await check('快速档：分析师失败超过阈值 → ANALYST_FAILURE', () => withTempDir(async (dir) => {
  await assert.rejects(
    () => runAnalysis({ symbol: '600519', tradeDate: '2026-11-20', tier: 'quick' }, {
      llm: stubLlm({ failOn: ['基本面分析师'] }),
      data: dataStub(snapshotStub()),
      homeDir: dir,
    }),
    (error) => error.code === 'ANALYST_FAILURE',
  );
}));

await check('快速档：VERDICT 缺失触发 1 次修复调用后成功', () => withTempDir(async (dir) => {
  const calls = { count: 0 };
  const result = await runAnalysis({ symbol: '600519', tradeDate: '2026-11-20', tier: 'quick' }, {
    llm: stubLlm({ noVerdictFirst: true, calls }),
    data: dataStub(snapshotStub()),
    homeDir: dir,
  });
  const json = JSON.parse(await readFile(result.files.json, 'utf8'));
  assert.deepEqual(validateReport(json), []);
  assert.equal(calls.count, 16, '8 次首次 + 8 次修复');
}));

await check('标准档：7 分析师 + 2 轮辩论 + 风控三方 + 复核 + 终审（18 调用）', () => withTempDir(async (dir) => {
  const events = [];
  const calls = { count: 0 };
  const result = await runAnalysis(
    { symbol: '600519', tradeDate: '2026-11-20', tier: 'standard', onEvent: (event) => events.push(event) },
    { llm: stubLlm({ calls }), data: dataStub(snapshotStub()), homeDir: dir },
  );
  const json = JSON.parse(await readFile(result.files.json, 'utf8'));
  assert.deepEqual(validateReport(json), []);
  assert.equal(json.tier, 'standard');
  assert.equal(json.debate.rounds, 2);
  assert.equal(json.roles.length, 16, 'standard 角色条目 = 16');
  assert.equal(calls.count, 18, '7 分析师 + 4 辩论 + 经理 + 提案 + 3 风控 + 复核 + 终审');
  assert.ok(json.risk.aggressive && json.risk.conservative && json.risk.neutral && json.risk.managerFeedback, 'risk 三方与复核意见入报告');
  assert.ok(json.roles.some((role) => role.id === 'risk_aggressive'));
  assert.ok(json.roles.some((role) => role.id === 'risk_manager'));
  assert.ok(events.some((event) => event.phase === 'risk'));
  assert.ok(events.some((event) => event.phase === 'risk-review'));
  assert.ok(events.filter((event) => event.phase === 'analysts').length === 7);
  const md = await readFile(result.files.md, 'utf8');
  assert.match(md, /仅供研究参考，不构成投资建议/);
}));

await check('深度档：3 轮辩论 + 2 次风控复核（22 调用）', () => withTempDir(async (dir) => {
  const calls = { count: 0 };
  const result = await runAnalysis(
    { symbol: '600519', tradeDate: '2026-11-20', tier: 'deep' },
    { llm: stubLlm({ calls }), data: dataStub(snapshotStub()), homeDir: dir },
  );
  const json = JSON.parse(await readFile(result.files.json, 'utf8'));
  assert.deepEqual(validateReport(json), []);
  assert.equal(json.tier, 'deep');
  assert.equal(json.debate.rounds, 3);
  assert.equal(json.roles.length, 17, 'deep 角色条目 = 17（含终审复核）');
  assert.ok(json.roles.some((role) => role.id === 'risk_manager-final'));
  assert.equal(calls.count, 22, '7 + 6 + 经理 + 提案 + 3 风控 + 复核 + 终审 + 终审复核 + 终审二次');
  assert.equal(json.models.usage.calls, 22);
}));

await check('check-report 拒绝坏报告', () => {
  assert.notDeepEqual(validateReport({ schemaVersion: '1.0' }), []);
});

console.log(`\ntest-pipeline: OK — ${assertions} 个用例全部通过（无网络、stub LLM）`);
