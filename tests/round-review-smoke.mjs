import { readFileSync } from 'node:fs';
import {
  ROUND_REVIEW_BASIS,
  ROUND_REVIEW_REASON,
  applyRoundReviewPolicy,
  hasExplicitRoundOrStage,
  isRoundReviewRow,
  requiresRoundReview,
} from '../functions/lib/input-contract.js';

let checks = 0;

for (const value of [
  'ATP 500 Example Round 1',
  'Wimbledon R16',
  'UK Championship 1/8 Final',
  'World Championship Quarterfinal',
  'Masters Semifinal',
  'Example Open Final',
  'WTA 250 Q2',
  'Tour Finals Group Stage',
]) {
  assert(hasExplicitRoundOrStage(value), `Expected explicit match round: ${value}`);
}

for (const value of [
  'ATP Challenger Qualification',
  'ATP Finals. Men Singles',
  'Tour Championship',
  'Championship League',
  'British Open',
]) {
  assert(!hasExplicitRoundOrStage(value), `Tournament name must not be mistaken for an explicit round: ${value}`);
}

assert(requiresRoundReview({ sport: 'Tennis', competition: 'ATP Finals. Men Singles' }), 'ATP Finals without a stated match stage must require review');
assert(requiresRoundReview({ sport: 'Snooker', competition: 'Tour Championship' }), 'Snooker Tour Championship without a stated round must require review');
assert(!requiresRoundReview({ sport: 'Tennis', competition: 'ATP Finals. Men Singles Group Stage' }), 'Explicit Tennis group stage must not require round review');
assert(!requiresRoundReview({ sport: 'Snooker', competition: 'Tour Championship Semifinal' }), 'Explicit Snooker semifinal must not require round review');
assert(!requiresRoundReview({ sport: 'Golf', competition: 'PGA Tour Example' }), 'Round-review exception must be limited to Tennis and Snooker');

const exactTennis = applyRoundReviewPolicy({
  dazn: 'RC G',
  quinnbet: 'RC F',
  nti: 'RC G',
  basis: 'Betradar Challenger Singles',
  confidence: 'Medium',
  manualCheck: false,
  needsEscalation: true,
  escalationReason: 'Round unclear',
}, { sport: 'Tennis', competition: 'ATP Challenger Nonthaburi. Men Singles' });
assert(exactTennis.confidence === 'High', 'Exact Tennis classes must stay/become High when only the round is missing');
assert(exactTennis.manualCheck === true, 'Exact Tennis classes without round must require manual check');
assert(exactTennis.manualCheckReason === ROUND_REVIEW_REASON, 'Tennis round-review reason is missing');
assert(exactTennis.basis === `Betradar Challenger Singles; ${ROUND_REVIEW_BASIS}`, 'Tennis Basis must explicitly explain the missing round');
assert(exactTennis.needsEscalation === false && exactTennis.escalationReason === '', 'Missing round alone must not escalate exact Tennis classes');
assert(isRoundReviewRow(exactTennis), 'Round-review row detector must recognize the approved exception');

const exactSnooker = applyRoundReviewPolicy({
  dazn: 'RC D', quinnbet: 'RC D', nti: 'RC D', basis: 'Other World Snooker Tour tournament', confidence: 'Medium', manualCheck: true,
}, { sport: 'Snooker', competition: 'British Open' });
assert(exactSnooker.confidence === 'High' && exactSnooker.manualCheck === true, 'Exact Snooker classes without round must be High/Yes');
assert(exactSnooker.basis.includes(ROUND_REVIEW_BASIS), 'Snooker Basis must explicitly explain the missing round');

const uncertainExact = applyRoundReviewPolicy({
  dazn: 'RC D', quinnbet: 'RC D', nti: 'RC D', basis: 'Uncertain same-sport analogy', confidence: 'Low', manualCheck: true, needsEscalation: true, escalationReason: 'Tournament strength is unclear',
}, { sport: 'Snooker', competition: 'Unknown Invitational' });
assert(uncertainExact.confidence === 'Low' && uncertainExact.manualCheck === true, 'Round exception must not hide genuine classification uncertainty');
assert(uncertainExact.basis.includes(ROUND_REVIEW_BASIS), 'Uncertain exact-valued row must still explicitly mention the absent round');

const recommended = applyRoundReviewPolicy({
  dazn: 'RC F rec.', quinnbet: 'RC F rec.', nti: 'RC F rec.', basis: 'Analogy', confidence: 'Medium', manualCheck: true,
}, { sport: 'Tennis', competition: 'Unknown Open Singles' });
assert(recommended.confidence === 'Medium' && recommended.manualCheck === true, 'Recommendation must never be promoted to High by the round exception');
assert(recommended.basis.includes(ROUND_REVIEW_BASIS), 'Recommended Tennis row must still explicitly mention the missing round');

const missing = applyRoundReviewPolicy({
  dazn: 'Manual check / missing rule', quinnbet: 'RC G', nti: 'RC G', basis: 'Incomplete mapping', confidence: 'Low', manualCheck: true,
}, { sport: 'Snooker', competition: 'Unknown Cup' });
assert(missing.confidence === 'Low' && missing.manualCheck === true, 'Missing rule must remain Low/Yes');

const qualificationWithoutRound = applyRoundReviewPolicy({
  dazn: 'RC E', quinnbet: 'RC E', nti: 'RC G', basis: 'Qualification', confidence: 'High', manualCheck: false, route: 'deterministic',
}, { sport: 'Tennis', competition: 'ATP 250 Example Qualification' });
assert(qualificationWithoutRound.confidence === 'High' && qualificationWithoutRound.manualCheck === true, 'Qualification without Q1-Q4 or another match round must be High/Yes');
assert(qualificationWithoutRound.basis.includes(ROUND_REVIEW_BASIS), 'Qualification without a match round must state the review reason');

const q2 = applyRoundReviewPolicy({
  dazn: 'RC E', quinnbet: 'RC E', nti: 'RC G', basis: 'Q2 qualification', confidence: 'High', manualCheck: false, route: 'deterministic',
}, { sport: 'Tennis', competition: 'ATP 250 Example Qualification Q2' });
assert(q2.manualCheck === false && !q2.basis.includes(ROUND_REVIEW_BASIS), 'Explicit Q2 must preserve normal High/No behavior');

const twice = applyRoundReviewPolicy(exactTennis, { sport: 'Tennis', competition: 'ATP Challenger Nonthaburi. Men Singles' });
assert(twice.basis.split(ROUND_REVIEW_BASIS).length === 2, 'Round-review Basis note must not be duplicated');

const analyzeSource = readFileSync(new URL('../functions/api/analyze-core.js', import.meta.url), 'utf8');
assert(analyzeSource.includes('Approved exception: when a Tennis or Snooker row has no explicit match round'), 'Server prompt must describe the exact High/Yes exception');
assert(analyzeSource.includes('Do not set needsEscalation merely for that missing-round exception'), 'Server prompt must prevent round-only escalation');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert(appSource.includes('const roundReview ='), 'Client guardrail must detect round-review rows');
assert(appSource.includes('finalConfidence === \'High\' && !roundReview'), 'Client guardrail must preserve High/Yes only for the approved exception');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert(htmlSource.includes('Tennis/Snooker without match round = High + manual check'), 'UI must show the round-review doctrine');

console.log(`round-review smoke tests passed (${checks} checks)`);

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
