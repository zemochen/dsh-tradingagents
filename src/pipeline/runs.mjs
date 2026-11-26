/**
 * In-memory run registry: single active analysis, ordered sparse events,
 * replay for SSE reconnect (`?from=`), cancellation.
 *
 * Contract: `<DOCS>/design/pipeline-runtime.md` §3 / §5.
 */

let counter = 0;

/** @returns {string} */
function nextRunId() {
  counter += 1;
  return `run-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** @returns {string} Asia/Shanghai ISO8601 (+08:00) */
function nowIso() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type) => p.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+08:00`;
}

export class RunConflictError extends Error {
  constructor(activeRunId) {
    super(`已有分析在跑（${activeRunId}）`);
    this.name = 'RunConflictError';
    this.code = 'RUN_ACTIVE';
    this.activeRunId = activeRunId;
  }
}

export class RunGoneError extends Error {
  constructor(runId) {
    super(`run 不存在或已因宿主重启丢失（${runId}）`);
    this.name = 'RunGoneError';
    this.code = 'RUN_GONE';
    this.runId = runId;
  }
}

/**
 * @typedef {object} RunEvent
 * @property {number} seq
 * @property {'run'|'phase'|'item'|'done'|'error'} type
 * @property {string} runId
 * @property {string} at
 * @property {string} message
 * @property {string} [phase]
 * @property {number} [index]
 * @property {number} [total]
 * @property {unknown} [data]
 */

export class RunRegistry {
  constructor() {
    /** @type {Map<string, any>} */
    this.runs = new Map();
    /** @type {string|null} */
    this.activeId = null;
  }

  /**
   * @param {{ tier: string, symbol: string, tradeDate?: string }} meta
   * @returns {any} the live run record (`id`, `meta`, `abort`, `status`)
   */
  create(meta) {
    if (this.activeId !== null) throw new RunConflictError(this.activeId);
    const id = nextRunId();
    const run = {
      id,
      meta,
      status: 'running', // running | done | failed | cancelled
      events: /** @type {RunEvent[]} */ ([]),
      listeners: new Set(),
      abort: new AbortController(),
      startedAt: nowIso(),
    };
    this.runs.set(id, run);
    this.activeId = id;
    return run;
  }

  /** @param {string} id */
  get(id) {
    return this.runs.get(id);
  }

  /** @param {string} id @returns {RunEvent[]} */
  eventsSince(id, from = 0) {
    const run = this.runs.get(id);
    if (!run) throw new RunGoneError(id);
    return run.events.filter((event) => event.seq >= from);
  }

  /**
   * @param {string} id
   * @param {Omit<RunEvent, 'seq'|'runId'|'at'>} event
   */
  emit(id, event) {
    const run = this.runs.get(id);
    if (!run) throw new RunGoneError(id);
    /** @type {RunEvent} */
    const full = { seq: run.events.length, runId: id, at: nowIso(), ...event };
    run.events.push(full);
    for (const listener of run.listeners) listener(full);
    return full;
  }

  /**
   * @param {string} id
   * @param {(event: RunEvent) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(id, listener) {
    const run = this.runs.get(id);
    if (!run) throw new RunGoneError(id);
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  /** @param {string} id @param {unknown} data */
  complete(id, data) {
    const run = this.runs.get(id);
    if (!run) throw new RunGoneError(id);
    this.emit(id, { type: 'done', message: '分析完成', data });
    run.status = 'done';
    this.finish(run);
  }

  /** @param {string} id @param {string} code @param {string} message @param {unknown} [data] */
  fail(id, code, message, data) {
    const run = this.runs.get(id);
    if (!run) return;
    if (run.status === 'running') {
      this.emit(id, { type: 'error', message, data: { code, ...(data ?? {}) } });
      run.status = 'failed';
      this.finish(run);
    }
  }

  /** @param {string} id */
  cancel(id) {
    const run = this.runs.get(id);
    if (!run) throw new RunGoneError(id);
    if (run.status !== 'running') return false;
    run.abort.abort();
    run.status = 'cancelled';
    this.emit(id, { type: 'error', message: '已取消', data: { code: 'CANCELLED' } });
    this.finish(run);
    return true;
  }

  /** @param {any} run */
  finish(run) {
    // Let subscribers read the terminal event before the registry forgets the run.
    queueMicrotask(() => {
      run.listeners.clear();
      if (this.activeId === run.id) this.activeId = null;
    });
  }

  dispose() {
    for (const run of this.runs.values()) {
      if (run.status === 'running') run.abort.abort();
    }
    this.runs.clear();
    this.activeId = null;
  }
}
