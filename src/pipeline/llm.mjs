/**
 * LLM call wrapper for the pipeline: concurrency cap, per-call timeout, one retry
 * on transient failures, usage accounting and a per-run token budget.
 *
 * Contract: `<DOCS>/design/pipeline-runtime.md` §4.
 * `llm` is injected (`ctx.llm` in the host, a stub in tests) and only needs
 * `stream(options) → AsyncIterable<StreamChunk>`.
 */

export class LlmCallError extends Error {
  /** @param {string} code @param {string} message @param {{ status?: number, cause?: unknown }} [extra] */
  constructor(code, message, { status, cause } = {}) {
    super(message);
    this.name = 'LlmCallError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

export class BudgetExceededError extends Error {
  constructor(budgetTokens, usedTokens) {
    super(`分析 token 预算超限（${usedTokens}/${budgetTokens}）`);
    this.name = 'BudgetExceededError';
    this.code = 'BUDGET_EXCEEDED';
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['RATE_LIMIT', 'SOURCE_TIMEOUT', 'SOURCE_HTTP', 'TIMEOUT', 'NETWORK_ERROR', 'provider-retry']);

/** @param {unknown} error */
export function isRetryable(error) {
  if (error instanceof LlmCallError) {
    if (error.status !== undefined) return RETRYABLE_STATUS.has(error.status);
    return RETRYABLE_CODES.has(error.code);
  }
  return false;
}

/** Simple FIFO semaphore. */
function createSemaphore(limit) {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];
  return async function acquire() {
    if (active >= limit) await new Promise((resolve) => queue.push(resolve));
    active += 1;
    return () => {
      active -= 1;
      queue.shift()?.();
    };
  };
}

/**
 * @param {{
 *   llm: { stream: (options: any) => AsyncIterable<any> },
 *   config: { analysts: any, judge: any },
 *   budgetTokens?: number,
 *   concurrency?: number,
 *   timeoutMs?: number,
 *   retries?: number,
 *   retryDelayMs?: number,
 *   sessionId?: string,
 * }} options
 */
export function createLlmRunner({
  llm,
  config,
  budgetTokens = 250_000,
  concurrency = 3,
  timeoutMs = 120_000,
  retries = 1,
  retryDelayMs = 500,
  sessionId,
}) {
  const acquire = createSemaphore(concurrency);
  const totals = { inputTokens: 0, outputTokens: 0, calls: 0 };

  function used() {
    return totals.inputTokens + totals.outputTokens;
  }

  function checkBudget() {
    if (used() > budgetTokens) throw new BudgetExceededError(budgetTokens, used());
  }

  /**
   * Harness messages carry ContentBlock[] (never a bare string):
   * `({role:'user', content:[{type:'text', text}]})`.
   * @param {any[]} messages
   */
  function normalizeMessages(messages) {
    return (messages ?? []).map((message) => (
      typeof message?.content === 'string'
        ? { ...message, content: [{ type: 'text', text: message.content }] }
        : message
    ));
  }

  /** @param {any} slot @returns {any} */
  function modelFor(slot) {
    return slot === 'judge' ? config.judge : config.analysts;
  }

  /**
   * @param {{
   *   slot?: 'analysts'|'judge',
   *   system?: string,
   *   messages: any[],
   *   maxTokens?: number,
   *   signal?: AbortSignal,
   *   temperature?: number,
   *   purpose?: string,
   * }} request
   */
  async function call(request) {
    checkBudget();
    const model = modelFor(request.slot);
    const release = await acquire();
    try {
      for (let attempt = 0; ; attempt += 1) {
        // Ref'd timer (not AbortSignal.timeout, whose timer is unref'd) so a hung
        // call is actually interrupted and the process/test does not exit early.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('llm call timeout')), timeoutMs);
        const forwardAbort = () => controller.abort();
        if (request.signal?.aborted) controller.abort();
        else request.signal?.addEventListener('abort', forwardAbort);
        const signal = controller.signal;
        try {
          totals.calls += 1;
          const result = await consume(() => llm.stream({
            provider: model.provider,
            model: model.model,
            reasoningEffort: model.effort,
            system: request.system,
            messages: normalizeMessages(request.messages),
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            // opencode-go requires x-opencode-session; the adapter derives it from
            // GenerateOptions.sessionId (pi-ai withOpenCodeSessionHeader).
            ...(request.sessionId ?? sessionId ? { sessionId: String(request.sessionId ?? sessionId) } : {}),
            signal,
          }));
          checkBudget();
          return result;
        } catch (error) {
          if (error instanceof BudgetExceededError) throw error;
          if (request.signal?.aborted) throw new LlmCallError('CANCELLED', '调用被取消', { cause: error });
          const normalized = error instanceof LlmCallError
            ? error
            : (error instanceof Error && error.name === 'AbortError'
              ? new LlmCallError('SOURCE_TIMEOUT', '调用超时', { cause: error })
              : new LlmCallError('LLM_CALL_FAILED', error instanceof Error ? error.message : String(error), { cause: error }));
          const last = attempt >= retries || !isRetryable(normalized);
          if (last) throw normalized;
          if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        } finally {
          clearTimeout(timer);
          request.signal?.removeEventListener?.('abort', forwardAbort);
        }
      }
    } finally {
      release();
    }
  }

  /** @param {() => AsyncIterable<any>} factory */
  async function consume(factory) {
    /** @type {string[]} */
    const text = [];
    let finishReason = null;
    /** @type {{ inputTokens: number, outputTokens: number } | null} */
    let usage = null;
    for await (const chunk of factory()) {
      if (chunk?.type === 'text-delta') text.push(chunk.text ?? '');
      else if (chunk?.type === 'usage') usage = normalizeUsage(chunk.usage);
      else if (chunk?.type === 'finish') {
        finishReason = chunk.reason?.kind ?? chunk.reason ?? null;
        if (chunk.reason?.kind === 'error') {
          const failure = chunk.reason.failure ?? {};
          throw new LlmCallError(failure.code ?? 'LLM_ERROR', failure.message ?? '模型调用失败', { status: failure.status });
        }
        if (chunk.reason?.kind === 'aborted') {
          throw new LlmCallError('CANCELLED', '模型调用被取消');
        }
      }
    }
    if (usage) {
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
    }
    return { text: text.join(''), finishReason, usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
  }

  return {
    call,
    usage: () => ({ ...totals }),
    remaining: () => Math.max(0, budgetTokens - used()),
  };
}

/** @param {any} usage */
function normalizeUsage(usage) {
  return {
    inputTokens: Number(usage?.inputTokens ?? 0) || 0,
    outputTokens: Number(usage?.outputTokens ?? 0) || 0,
  };
}
