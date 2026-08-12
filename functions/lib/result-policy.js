import { resolveGlobalBrands } from './input-contract.js';

export const ROUND_REVIEW_REASON = 'Stage/round not provided — High confidence retained; stage check required.';

const ROUND_CONTEXT_PATTERNS = [
  /\bq[1-4]\b/i,
  /\b(?:first|second|third|fourth|opening)\s+round\b/i,
  /\b(?:round|rnd)\s*(?:of\s*)?(?:1|2|3|4|8|16|32|64|128)\b/i,
  /\b(?:r|rd)\s*[-.]?\s*(?:1|2|3|4|8|16|32|64|128)\b/i,
  /\b(?:r16|r32|r64|r128|qf|sf)\b/i,
  /\b(?:quarter|semi)[ -]?finals?\b/i,
  /\b(?:1\/8|1\/4|1\/2)\s*finals?\b/i,
  /\blast\s+(?:8|16|32|64|128)\b/i,
  /\bfinal\b/i,
  /(?:^|[-–—,:])\s*finals?\b/i,
  /\b(?:group|round[- ]?robin)\s+stage\b/i,
  /\bstage\s+\d+\b/i,
];

export function enforceResultPolicy(row, input = row) {
  const resolved = resolveGlobalBrands(row);
  const values = [resolved?.dazn, resolved?.quinnbet, resolved?.nti].map((value) => String(value || ''));
  const hasRec = values.some((value) => /\brec\./i.test(value));
  const hasMissing = values.some((value) => /manual check|missing rule/i.test(value));
  let confidence = ['High', 'Medium', 'Low'].includes(resolved?.confidence) ? resolved.confidence : 'Low';
  if (hasMissing) confidence = 'Low';
  else if (hasRec && confidence === 'High') confidence = 'Medium';

  let manualCheck = confidence !== 'High' || hasRec || hasMissing;
  let manualCheckReason = String(resolved?.manualCheckReason || '').trim();
  let basis = String(resolved?.basis || '').trim();

  const roundReview = needsRoundReview(input);
  if (roundReview) {
    manualCheck = true;
    manualCheckReason = appendReason(manualCheckReason, ROUND_REVIEW_REASON);
  }

  return {
    ...resolved,
    basis,
    confidence,
    manualCheck,
    manualCheckReason,
    // A missing round is an explicit operational review flag, not material class
    // uncertainty and therefore must not trigger another AI stage.
    needsEscalation: roundReview && confidence === 'High' && !hasRec && !hasMissing
      ? false
      : Boolean(resolved?.needsEscalation),
    escalationReason: roundReview && confidence === 'High' && !hasRec && !hasMissing
      ? ''
      : String(resolved?.escalationReason || ''),
  };
}

export function needsRoundReview(input) {
  const sport = normalizeSport(input?.sport);
  if (sport !== 'tennis' && sport !== 'snooker') return false;

  const competition = String(input?.competition || '').trim();
  if (!competition) return false;
  if (/\boutright\b|\btournament winner\b|\bchampionship winner\b/i.test(competition)) return false;
  if (sport === 'tennis' && /\b(srl|simulated reality|virtuals?|simulated)\b/i.test(competition)) return false;

  return !hasExplicitRoundContext(competition);
}

export function hasExplicitRoundContext(value) {
  const competition = String(value || '').trim();
  if (!competition) return false;
  return ROUND_CONTEXT_PATTERNS.some((pattern) => pattern.test(competition));
}

function appendReason(existing, reason) {
  const text = String(existing || '').trim();
  if (!text) return reason;
  if (text.toLowerCase().includes(reason.toLowerCase())) return text;
  return `${text}; ${reason}`;
}

function normalizeSport(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
