import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveGlobalBrands } from '../functions/lib/input-contract.js';
import { enforceResultPolicy } from '../functions/lib/result-policy.js';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';

const inherited = resolveGlobalBrands({
  global: 'RC B', daznEs: '', daznDe: 'Same as Global', daznUk: 'RC C',
  dazn: 'RC H', quinnbet: 'RC A', nti: 'RC A',
});
assert.equal(inherited.daznEs, 'RC B');
assert.equal(inherited.daznDe, 'RC B');
assert.equal(inherited.daznUk, 'RC C');
assert.equal(Object.hasOwn(inherited, 'dazn'), false);
assert.equal(Object.hasOwn(inherited, 'quinnbet'), false);
assert.equal(Object.hasOwn(inherited, 'nti'), false);
const result = enforceResultPolicy({ ...inherited, confidence: 'High', basis: 'Managed rule' }, {}, []);
assert.equal(result.confidence, 'High');
assert.equal(result.manualCheck, false);

const rules = [{
  id: 'example', sport: 'cricket', match: { exact: ['Example competition'] },
  global: 'RC G', daznEs: 'RC E', daznDe: 'Same as Global', daznUk: '', basis: 'Managed rule',
}];
const index = buildRuntimeIndex({ deterministicRules: { rules }, resultTransforms: [{
  id: 'example-transform', match: { any: ['example'] }, brandMap: { 'RC G': 'RC F', 'RC E': 'RC D' },
}] });
const classified = classifyDeterministic({ sport: 'Cricket', competition: 'Example competition' }, index);
assert.equal(classified.global, 'RC F');
assert.equal(classified.daznEs, 'RC D');
assert.equal(classified.daznDe, 'RC F');
assert.equal(classified.daznUk, 'RC F');
assert.equal(Object.hasOwn(classified, 'quinnbet'), false);

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pipeline = readFileSync(new URL('../functions/api/analyze-core.js', import.meta.url), 'utf8');
assert.match(app, /DAZN ES/);
assert.match(app, /DAZN DE/);
assert.match(app, /DAZN UK/);
assert.doesNotMatch(app, /Quinnbet|\bnti\b/i);
assert.doesNotMatch(html, /Quinnbet|\bnti\b/i);
assert.match(pipeline, /'daznEs', 'daznDe', 'daznUk'/);
assert.doesNotMatch(pipeline, /\bquinnbet\s*:/i);
console.log('three-brand schema, Global inheritance, transform and export smoke tests passed');
