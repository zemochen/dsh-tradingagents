/**
 * Plugin configuration: two model slots + paper fee schedule.
 *
 * Zero-dependency on purpose (the linked plugin has no node_modules): `Config` is a
 * hand-written **Standard Schema** (`~standard.validate`), which is the only shape
 * Cordis accepts for a plugin's config schema.
 */

export const DEFAULT_CONFIG = Object.freeze({
  analysts: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', effort: 'low' },
  judge: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', effort: 'high' },
  fees: {
    commissionRate: 0.0003, // 万三
    minCommission: 5, // 元
    stampRate: 0.0005, // 印花税，仅卖出
    transferRate: 0.00001, // 过户费，双边
  },
});

const EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'max']);

/** @param {unknown} value @returns {value is string} */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** @param {unknown} value @returns {value is number} */
function isRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1;
}

/**
 * Merge user config over defaults and validate. Returns `{value}` or `{issues}`.
 * @param {any} input
 * @returns {{ value: any, issues: Array<{ message: string, path: Array<string> }> }}
 */
export function normalizeConfig(input) {
  const source = input !== null && typeof input === 'object' ? input : {};
  /** @type {Array<{ message: string, path: string[] }>} */
  const issues = [];

  const slot = (name, fallback) => {
    const raw = source[name] ?? {};
    const out = { ...fallback };
    if (raw.provider !== undefined) {
      if (!isNonEmptyString(raw.provider)) issues.push({ message: `${name}.provider 必须是非空字符串`, path: [name, 'provider'] });
      else out.provider = raw.provider;
    }
    if (raw.model !== undefined) {
      if (!isNonEmptyString(raw.model)) issues.push({ message: `${name}.model 必须是非空字符串`, path: [name, 'model'] });
      else out.model = raw.model;
    }
    if (raw.effort !== undefined) {
      if (!EFFORTS.has(raw.effort)) issues.push({ message: `${name}.effort 非法：${String(raw.effort)}`, path: [name, 'effort'] });
      else out.effort = raw.effort;
    }
    return out;
  };

  const fees = { ...DEFAULT_CONFIG.fees };
  for (const key of ['commissionRate', 'stampRate', 'transferRate']) {
    if (source.fees?.[key] !== undefined) {
      if (!isRate(source.fees[key])) issues.push({ message: `fees.${key} 必须是 [0,1) 比率`, path: ['fees', key] });
      else fees[key] = source.fees[key];
    }
  }
  if (source.fees?.minCommission !== undefined) {
    const value = source.fees.minCommission;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      issues.push({ message: 'fees.minCommission 必须是非负数', path: ['fees', 'minCommission'] });
    } else {
      fees.minCommission = value;
    }
  }

  return {
    value: { analysts: slot('analysts', DEFAULT_CONFIG.analysts), judge: slot('judge', DEFAULT_CONFIG.judge), fees },
    issues,
  };
}

/**
 * Standard Schema wrapper. Cordis calls `Config['~standard'].validate(raw)`.
 * `~standard.version` is required by the spec; `vendor` is informational.
 */
export const Config = {
  '~standard': {
    version: /** @type {const} */ (1),
    vendor: 'dsh-tradingagents',
    /**
     * @param {unknown} input
     * @returns {{ value: any } | { issues: Array<{ message: string, path: string[] }> }}
     */
    validate(input) {
      const result = normalizeConfig(input);
      if (result.issues.length > 0) return { issues: result.issues };
      return { value: result.value };
    },
  },
};
