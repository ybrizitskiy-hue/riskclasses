import { resolveGlobalBrands } from './input-contract.js';

export function enforceResultPolicy(row, input = row, policies = []) {
  const resolved = resolveGlobalBrands(row);
  const values = [resolved?.dazn, resolved?.quinnbet, resolved?.nti].map((value) => String(value || ''));
  const hasRec = values.some((value) => /\brec\./i.test(value));
  const hasMissing = values.some((value) => /manual check|missing rule/i.test(value));
  let confidence = ['High', 'Medium', 'Low'].includes(resolved?.confidence) ? resolved.confidence : 'Low';
  if (hasMissing) confidence = 'Low';
  else if (hasRec && confidence === 'High') confidence = 'Medium';

  let manualCheck = Boolean(resolved?.manualCheck) || confidence !== 'High' || hasRec || hasMissing;
  let manualCheckType = String(resolved?.manualCheckType || '').trim();
  let manualCheckReason = String(resolved?.manualCheckReason || '').trim();
  let needsEscalation = Boolean(resolved?.needsEscalation);
  let escalationReason = String(resolved?.escalationReason || '');

  for (const policy of Array.isArray(policies) ? policies : []) {
    if (!matchesPolicy(policy, input, { confidence })) continue;
    manualCheck = policy.manualCheck !== false;
    if (policy.manualCheckType) manualCheckType = String(policy.manualCheckType);
    if (policy.reason) manualCheckReason = appendReason(manualCheckReason, String(policy.reason));
    if (policy.suppressEscalationWhenHigh && confidence === 'High' && !hasRec && !hasMissing) {
      needsEscalation = false;
      escalationReason = '';
    }
  }

  if (!manualCheck) manualCheckType = 'No';
  else if (!manualCheckType || manualCheckType === 'No') manualCheckType = 'Yes';

  return {
    ...resolved,
    confidence,
    manualCheck,
    manualCheckType,
    manualCheckReason,
    needsEscalation,
    escalationReason,
  };
}

export function matchesPolicy(policy, input, result = {}) {
  if (!policy || typeof policy !== 'object') return false;
  const confidences = Array.isArray(policy.confidences) ? policy.confidences : [];
  if (confidences.length && !confidences.includes(String(result?.confidence || ''))) return false;

  const sports = (Array.isArray(policy.sports) ? policy.sports : []).map(normalize);
  if (sports.length && !sports.includes(normalize(input?.sport || ''))) return false;

  const providers = (Array.isArray(policy.providers) ? policy.providers : []).map(normalize);
  if (providers.length && !providers.includes(normalize(input?.dataProvider || ''))) return false;

  const field = String(policy.field || 'competition');
  const value = String(input?.[field] ?? '');
  const excluded = compile(policy.excludePatterns);
  if (excluded.some((pattern) => pattern.test(value))) return false;

  const required = compile(policy.requirePatterns);
  if (required.length && !required.every((pattern) => pattern.test(value))) return false;

  const missing = compile(policy.whenMissingPatterns);
  if (missing.length && missing.some((pattern) => pattern.test(value))) return false;

  return Boolean(confidences.length || sports.length || providers.length || required.length || missing.length || excluded.length);
}

function compile(values) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string' || !value) continue;
    try { output.push(new RegExp(value, 'i')); } catch { /* validation handles it */ }
  }
  return output;
}

function appendReason(existing, reason) {
  const text = String(existing || '').trim();
  if (!text) return reason;
  if (text.toLowerCase().includes(reason.toLowerCase())) return text;
  return `${text}; ${reason}`;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
