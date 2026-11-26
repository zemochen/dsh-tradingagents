/**
 * Pipeline entry: `runAnalysis(options, deps)`.
 *
 * Executes the requested tier (quick / standard / deep). All external effects are
 * injected so the host passes `ctx.llm` / `src/data`, while tests pass stubs and a
 * temp home dir.
 */
import { normalizeConfig } from './config.mjs';
import { createLlmRunner } from './llm.mjs';
import { fetchSnapshot } from '../data/index.mjs';
import { PipelineError, runTier, TIER_PLANS } from './stages.mjs';

export { PipelineError, TIER_PLANS };

/**
 * @param {{
 *   symbol: string, tradeDate: string, tier?: 'quick'|'standard'|'deep',
 *   onEvent?: (event: any) => void, signal?: AbortSignal,
 * }} options
 * @param {{
 *   llm: any, config?: any, data?: { fetchSnapshot: Function },
 *   homeDir?: string, budgetTokens?: number, concurrency?: number, timeoutMs?: number,
 *   sessionId?: string,
 * }} deps
 */
export async function runAnalysis(options, deps) {
  const tier = options.tier ?? 'standard';
  if (!TIER_PLANS[tier]) throw new PipelineError('INVALID_TIER', `档位非法：${tier}`);
  const { value: config } = normalizeConfig(deps.config);
  const llm = createLlmRunner({
    llm: deps.llm,
    config,
    budgetTokens: deps.budgetTokens,
    concurrency: deps.concurrency,
    timeoutMs: deps.timeoutMs,
    sessionId: deps.sessionId,
  });
  return runTier({
    symbol: options.symbol,
    tier,
    tradeDate: options.tradeDate,
    llm,
    config,
    data: deps.data ?? { fetchSnapshot },
    onEvent: options.onEvent,
    signal: options.signal,
    homeDir: deps.homeDir,
  });
}
