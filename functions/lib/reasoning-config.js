export const REASONING_CONFIG_KEY = 'ai-reasoning-config-v1';
export const REASONING_SCHEMA_VERSION = 1;

const MODES = ['economy', 'auto', 'quality'];
const ROLES = ['extraction', 'primary', 'research', 'escalation'];
const EFFORTS = new Set(['none', 'low', 'medium', 'high']);

export function defaultReasoningConfig() {
  const modes = {};
  for (const mode of MODES) {
    modes[mode] = {
      extraction: 'low',
      primary: 'medium',
      research: 'medium',
      escalation: 'medium',
    };
  }
  return {
    schemaVersion: REASONING_SCHEMA_VERSION,
    version: 'reasoning-v1',
    modes,
  };
}

export async function loadReasoningConfig(env, { persistDefault = false } = {}) {
  const kv = env?.RISK_RULES;
  if (kv && typeof kv.get === 'function') {
    try {
      const raw = await kv.get(REASONING_CONFIG_KEY);
      if (raw) {
        const candidate = normalizeReasoningConfig(JSON.parse(raw));
        const validation = validateReasoningConfig(candidate);
        if (validation.valid) return candidate;
      }
    } catch {
      // Fall through to defaults so analysis behavior remains backwards compatible.
    }
  }

  const fallback = defaultReasoningConfig();
  if (persistDefault && kv && typeof kv.put === 'function') {
    try { await kv.put(REASONING_CONFIG_KEY, JSON.stringify(fallback)); } catch { /* non-fatal */ }
  }
  return fallback;
}

export async function saveReasoningConfig(env, value) {
  const normalized = normalizeReasoningConfig(value);
  const validation = validateReasoningConfig(normalized);
  if (!validation.valid) {
    const error = new Error(validation.errors.join(' '));
    error.validation = validation;
    throw error;
  }

  const kv = env?.RISK_RULES;
  if (!kv || typeof kv.put !== 'function') throw new Error('RISK_RULES KV binding does not support writes.');
  if (!normalized.version || normalized.version === 'reasoning-v1') normalized.version = revisionName(normalized.version || 'reasoning');
  await kv.put(REASONING_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

export function normalizeReasoningConfig(value) {
  const defaults = defaultReasoningConfig();
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {
    schemaVersion: REASONING_SCHEMA_VERSION,
    version: String(source.version || defaults.version).trim() || defaults.version,
    modes: {},
  };

  for (const mode of MODES) {
    const candidate = source.modes?.[mode] || {};
    normalized.modes[mode] = {};
    for (const role of ROLES) {
      const effort = String(candidate[role] ?? defaults.modes[mode][role]).trim().toLowerCase();
      normalized.modes[mode][role] = effort;
    }
  }
  return normalized;
}

export function validateReasoningConfig(value) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['Reasoning configuration must be a JSON object.'], warnings };
  }
  if (Number(value.schemaVersion) !== REASONING_SCHEMA_VERSION) errors.push(`schemaVersion must be ${REASONING_SCHEMA_VERSION}.`);
  if (!value.modes || typeof value.modes !== 'object' || Array.isArray(value.modes)) errors.push('modes must be an object.');

  for (const mode of MODES) {
    const settings = value.modes?.[mode];
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      errors.push(`Missing ${mode} reasoning configuration.`);
      continue;
    }
    for (const role of ROLES) {
      const effort = String(settings[role] || '').trim().toLowerCase();
      if (!EFFORTS.has(effort)) errors.push(`${mode}.${role} must be one of: none, low, medium, high.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function effortFor(config, mode, role) {
  const selectedMode = MODES.includes(mode) ? mode : 'auto';
  const selectedRole = ROLES.includes(role) ? role : 'primary';
  const normalized = normalizeReasoningConfig(config);
  const effort = normalized.modes[selectedMode][selectedRole];
  return effort === 'none' ? null : effort;
}

function revisionName(prefix) {
  return `${prefix}-r${new Date().toISOString().replace(/[:.]/g, '-')}`;
}
