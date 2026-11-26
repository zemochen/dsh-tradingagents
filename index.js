/**
 * Host half of `@local/dsh-tradingagents`.
 *
 * The Cordis Loader imports this file as an ordinary ESM plugin and expects
 * `export function apply(ctx, config)` (+ optional `Config` / `inject`).
 * Contract evidence: `docs/plugin-contract.md`, repo `AGENTS.md`.
 *
 * Host half: config schema, run registry, `/dsh-tradingagents/api/*` routes + SSE,
 * report index/read, watchlist and paper account. `/analyze` runs quick/standard/deep.
 * Nothing here may grow order/trade execution: research workstation, not a broker.
 */
import { Config, normalizeConfig } from './src/pipeline/config.mjs';
import { runAnalysis } from './src/pipeline/index.mjs';
import { loadIndex, reportsDir } from './src/pipeline/report.mjs';
import {
  PaperError, closePosition, openPosition, paperSnapshot, resetPaper, setInitialCapital,
} from './src/pipeline/paper.mjs';
import { loadWatchlist, updateWatchlist } from './src/pipeline/watchlist.mjs';
import { fetchLatestQuote } from './src/data/index.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RunConflictError, RunGoneError, RunRegistry } from './src/pipeline/runs.mjs';
import { parseSymbol } from './src/data/normalize.mjs';
import { InputRejectedError } from './src/data/errors.mjs';

export { Config };

/** Hard dependency: the Web carrier is the only transport for the browser half. */
export const inject = ['webServer'];

const API_PREFIX = '/dsh-tradingagents/api';
const TIERS = new Set(['quick', 'standard', 'deep']);
const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** @param {number} status @param {unknown} body */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** @param {Response|Error} value */
function toResponse(value) {
  if (value instanceof Error) {
    if (value instanceof InputRejectedError) return json(422, { error: value.code, message: value.message });
    if (value instanceof RunConflictError) return json(409, { error: value.code, message: value.message, runId: value.activeRunId });
    if (value instanceof RunGoneError) return json(410, { error: value.code, message: value.message });
    if (value instanceof PaperError) return json(value.status, { error: value.code, message: value.message });
    if (value instanceof HttpError) return json(value.status, { error: value.code, message: value.message });
    return json(500, { error: 'INTERNAL', message: value.message });
  }
  return value;
}

/** @param {Request} request @returns {Promise<any>} */
async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', '请求体过大');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是合法 JSON');
  }
}

/**
 * @param {Request} request
 * @param {RunRegistry} runs
 */
async function handleAnalyze(request, runs, deps) {
  const body = await readJson(request);
  const symbol = parseSymbol(body.symbol).symbol;
  const tier = body.tier ?? 'standard';
  if (!TIERS.has(tier)) throw new HttpError(422, 'INVALID_TIER', `档位非法：${String(tier)}（quick|standard|deep）`);

  if (body.tradeDate !== undefined) {
    if (typeof body.tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.tradeDate)) {
      throw new HttpError(422, 'INVALID_TRADE_DATE', 'tradeDate 必须是 YYYY-MM-DD 字符串');
    }
  }
  if (!deps.llm) throw new HttpError(503, 'LLM_UNAVAILABLE', '宿主 llm 服务不可用');

  const run = runs.create({ symbol, tier, tradeDate: body.tradeDate ?? null });
  runs.emit(run.id, { type: 'run', phase: 'validate', message: `开始分析 ${symbol}（${tier}）` });

  queueMicrotask(async () => {
    try {
      const result = await runAnalysis({
        symbol,
        tradeDate: body.tradeDate,
        tier,
        onEvent: (event) => runs.emit(run.id, event),
        signal: run.abort.signal,
      }, {
        llm: deps.llm,
        config: deps.config,
        data: deps.data,
        homeDir: deps.homeDir,
        sessionId: run.id,
      });
      runs.complete(run.id, { reportId: result.id });
    } catch (error) {
      const code = error?.code ?? 'PIPELINE_FAILED';
      if (run.status === 'running') runs.fail(run.id, code, error?.message ?? String(error), error?.data);
    }
  });

  return json(202, { runId: run.id });
}

/**
 * @param {string} runId
 * @param {string} path
 * @param {URLSearchParams} query
 * @param {Request} request
 * @param {RunRegistry} runs
 */
function handleRunRequest(runId, path, query, request, runs) {
  if (path.endsWith('/events') && request.method === 'GET') return eventStream(runId, query, runs);
  if (path.endsWith('/cancel') && request.method === 'POST') {
    const cancelled = runs.cancel(runId);
    return json(202, { cancelled });
  }
  throw new HttpError(404, 'NOT_FOUND', `未知路由：${request.method} ${API_PREFIX}${path}`);
}

/** @param {string} runId @param {URLSearchParams} query @param {RunRegistry} runs */
function eventStream(runId, query, runs) {
  if (!runs.get(runId)) throw new RunGoneError(runId);
  const from = Math.max(0, Number(query.get('from') ?? '0') || 0);
  const encoder = new TextEncoder();
  /** @type {() => void} */
  let unsubscribe = () => {};
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
        if (event.type === 'done' || event.type === 'error') close();
      };
      for (const event of runs.eventsSince(runId, from)) send(event);
      if (closed) return;
      unsubscribe = runs.subscribe(runId, send);
    },
    cancel() {
      closed = true;
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

/** @param {string} id @param {string|undefined} homeDir */
async function readReport(id, homeDir) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpError(400, 'INVALID_REPORT_ID', 'reportId 非法');
  try {
    return JSON.parse(await readFile(join(reportsDir(homeDir), `${id}.decision.json`), 'utf8'));
  } catch {
    throw new HttpError(404, 'REPORT_NOT_FOUND', `报告不存在：${id}`);
  }
}

/** @param {any} deps @param {string} symbol */
async function quoteOrThrow(deps, symbol) {
  const result = await deps.quote({ symbol });
  if (!result.ok) {
    throw new HttpError(503, 'QUOTE_UNAVAILABLE', `行情不可用：${result.error?.code ?? 'EMPTY'} ${result.error?.message ?? ''}`.trim());
  }
  return result;
}

/**
 * @param {Request} request
 * @param {RunRegistry} runs
 */
async function handle(request, runs, deps) {
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length) || '/';
  const runMatch = /^\/runs\/([^/]+)/.exec(path);
  if (runMatch) return handleRunRequest(decodeURIComponent(runMatch[1]), path, url.searchParams, request, runs);
  if (request.method === 'POST' && path === '/analyze') return handleAnalyze(request, runs, deps);
  // Route table: analysis/reports/watchlist/paper (see design/pipeline-runtime.md §2).
  if (request.method === 'GET' && path === '/reports') {
    const index = await loadIndex(deps.homeDir);
    const requested = Number(url.searchParams.get('limit') ?? '0');
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : null;
    return json(200, { items: limit ? index.items.slice(0, limit) : index.items });
  }
  if (request.method === 'GET' && path.startsWith('/reports/')) {
    const id = decodeURIComponent(path.slice('/reports/'.length));
    return json(200, { report: await readReport(id, deps.homeDir) });
  }
  if (request.method === 'GET' && path === '/quotes') {
    const symbols = String(url.searchParams.get('symbols') ?? '')
      .split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
    const quotes = {};
    for (const symbol of symbols) {
      try {
        const quote = await deps.quote({ symbol });
        quotes[symbol] = quote.ok
          ? { ok: true, source: quote.source, asOf: quote.asOf, name: quote.quote?.name ?? null, price: quote.quote?.price ?? null, changePct: quote.quote?.changePct ?? null }
          : { ok: false, attempts: quote.attempts, error: quote.error };
      } catch (error) {
        quotes[symbol] = { ok: false, error: { code: error?.code ?? 'ERROR', message: error?.message ?? String(error) } };
      }
    }
    return json(200, { quotes });
  }
  if (request.method === 'GET' && path === '/watchlist') {
    return json(200, await loadWatchlist(deps.homeDir));
  }
  if (request.method === 'POST' && path === '/watchlist') {
    const body = await readJson(request);
    const add = Array.isArray(body.add) ? body.add : [];
    const remove = Array.isArray(body.remove) ? body.remove : [];
    return json(200, await updateWatchlist({ homeDir: deps.homeDir, add, remove }));
  }
  if (request.method === 'GET' && path === '/paper') {
    return json(200, await paperSnapshot(deps.homeDir));
  }
  if (request.method === 'POST' && path === '/paper/open') {
    const body = await readJson(request);
    if (typeof body.reportId !== 'string') throw new HttpError(422, 'INVALID_REPORT_ID', 'reportId 必填');
    const report = await readReport(body.reportId, deps.homeDir);
    const symbol = report.symbol;
    const quote = await quoteOrThrow(deps, symbol);
    const result = await openPosition({
      homeDir: deps.homeDir,
      symbol,
      name: report.name,
      shares: body.shares,
      price: quote.quote.price,
      quoteSource: quote.source,
      quoteAsOf: quote.asOf,
      reportId: body.reportId,
      positionPct: report.verdict?.positionPct ?? 0,
      fees: deps.config?.fees,
    });
    return json(201, { ...result, quote: { price: quote.quote.price, asOf: quote.asOf, source: quote.source } });
  }
  if (request.method === 'POST' && path === '/paper/close') {
    const body = await readJson(request);
    const symbol = parseSymbol(body.symbol).symbol;
    const quote = await quoteOrThrow(deps, symbol);
    const result = await closePosition({
      homeDir: deps.homeDir,
      symbol,
      shares: body.shares,
      price: quote.quote.price,
      fees: deps.config?.fees,
    });
    return json(200, { ...result, quote: { price: quote.quote.price, asOf: quote.asOf, source: quote.source } });
  }
  if (request.method === 'POST' && path === '/paper/reset') {
    return json(200, await resetPaper(deps.homeDir));
  }
  if (request.method === 'POST' && path === '/paper/initial-capital') {
    const body = await readJson(request);
    return json(200, await setInitialCapital({ homeDir: deps.homeDir, initialCapital: body.initialCapital }));
  }
  throw new HttpError(404, 'NOT_FOUND', `未知路由：${request.method} ${url.pathname}`);
}

/** @param {import('node:http').IncomingMessage} req */
function toFetchRequest(req) {
  const url = new URL(req.url ?? '/', `http://${req.headers?.host ?? '127.0.0.1'}`);
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return Promise.resolve(new Request(url, { method }));
  return (async () => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', '请求体过大');
      chunks.push(Buffer.from(chunk));
    }
    return new Request(url, { method, body: Buffer.concat(chunks) });
  })();
}

/**
 * Create the fetch-style runtime used by both the HTTP adapter and tests.
 * @param {{ llm?: any, config?: any, data?: any, homeDir?: string, quote?: Function }} deps
 */
export function createRuntime(deps = {}) {
  const runs = new RunRegistry();
  const runtimeDeps = {
    llm: deps.llm,
    config: deps.config,
    data: deps.data,
    homeDir: deps.homeDir,
    quote: deps.quote ?? fetchLatestQuote,
  };
  return {
    /** @param {Request} request */
    async handleFetch(request) {
      try {
        return await handle(request, runs, runtimeDeps);
      } catch (error) {
        return toResponse(error instanceof Error ? error : new Error(String(error)));
      }
    },
    dispose() {
      runs.dispose();
    },
  };
}

/** Node HTTP adapter for the host webserver's `handler` route form (POST + SSE). */
function createNodeHandler(runtime) {
  return async function nodeHandler(req, res) {
    let response;
    try {
      const request = await toFetchRequest(req);
      response = await runtime.handleFetch(request);
    } catch (error) {
      response = toResponse(error instanceof Error ? error : new Error(String(error)));
    }
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (!response.body || req.method === 'HEAD') {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    let closed = false;
    res.on('close', () => {
      closed = true;
      reader.cancel().catch(() => {});
    });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        res.write(Buffer.from(value));
      }
    } catch {
      // client went away mid-stream
    }
    if (!closed) res.end();
  };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const { value: config } = normalizeConfig(rawConfig);
  const runtime = createRuntime({ llm: ctx.get('llm'), config });

  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const dispose = hostCtx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: createNodeHandler(runtime),
      });
      return () => {
        dispose?.();
        runtime.dispose();
      };
    }, 'dsh-tradingagents: routes');
  });
}
