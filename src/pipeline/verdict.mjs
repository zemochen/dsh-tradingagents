/**
 * VERDICT parsing: every role must end with a ```json block carrying a machine
 * readable verdict. No regex-guessing from natural language (pipeline.md §4).
 *
 * Contract shape: { direction, confidence, positionPct, entryRange, stopLoss,
 * target, oneLineReason } — see `<DOCS>/design/report.md` §2.
 */

const DIRECTIONS = new Map([
  ['bullish', 'bullish'], ['看多', 'bullish'], ['多', 'bullish'],
  ['bearish', 'bearish'], ['看空', 'bearish'], ['空', 'bearish'],
  ['neutral', 'neutral'], ['中性', 'neutral'], ['震荡', 'neutral'],
]);

export class VerdictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerdictError';
    this.code = 'VERDICT_INVALID';
  }
}

/** @param {unknown} value */
function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} value @param {number} max */
function intInRange(value, max) {
  const parsed = numOrNull(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(max, Math.round(parsed)));
}

/**
 * Extract the last fenced ```json block from model text.
 * @param {string} text
 * @returns {string|null}
 */
export function extractJsonBlock(text) {
  const source = String(text ?? '');
  const matches = [...source.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

/**
 * @param {string} text
 * @returns {any|null} normalized verdict, or null when absent/invalid
 */
export function parseVerdict(text) {
  const block = extractJsonBlock(text);
  if (!block) return null;
  let raw;
  try {
    raw = JSON.parse(block);
  } catch {
    return null;
  }
  return normalizeVerdict(raw);
}

/**
 * @param {any} raw
 * @returns {any}
 */
export function normalizeVerdict(raw) {
  if (!raw || typeof raw !== 'object') throw new VerdictError('VERDICT 不是对象');
  const direction = DIRECTIONS.get(String(raw.direction ?? '').trim().toLowerCase()) ?? DIRECTIONS.get(String(raw.direction ?? '').trim());
  if (!direction) throw new VerdictError(`direction 非法：${String(raw.direction)}`);
  const confidence = intInRange(raw.confidence, 100);
  if (confidence === null) throw new VerdictError('confidence 必填（0–100）');
  const positionPct = intInRange(raw.positionPct ?? 0, 100) ?? 0;
  let entryRange = null;
  if (Array.isArray(raw.entryRange) && raw.entryRange.length === 2) {
    const low = numOrNull(raw.entryRange[0]);
    const high = numOrNull(raw.entryRange[1]);
    if (low !== null && high !== null && low <= high) entryRange = [low, high];
    else if (low !== null && high !== null) entryRange = [high, low];
  }
  return {
    direction,
    confidence,
    positionPct,
    entryRange,
    stopLoss: numOrNull(raw.stopLoss),
    target: numOrNull(raw.target),
    oneLineReason: String(raw.oneLineReason ?? raw.reason ?? '').slice(0, 200) || null,
  };
}

/**
 * Validate that a role reply carries a parseable verdict; throws on failure.
 * @param {string} text
 * @param {string} roleId
 */
export function requireVerdict(text, roleId) {
  const verdict = parseVerdict(text);
  if (!verdict) throw new VerdictError(`${roleId} 未产出合法 VERDICT`);
  return verdict;
}
