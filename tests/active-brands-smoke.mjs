import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveGlobalBrands } from '../functions/lib/input-contract.js';
import { enforceResultPolicy } from '../functions/lib/result-policy.js';
import { buildRuntimeIndex, classifyDeterministic } from '../functions/lib/deterministic.js';

const inherited = resolveGlobalBrands({global:'RC B', dazn:'', quinnbet:'', nti:'Manual check / missing rule'});
assert.equal(inherited.dazn, 'RC B');
assert.equal(inherited.quinnbet, 'RC B');
assert.equal(Object.hasOwn(inherited, 'nti'), false);
const result = enforceResultPolicy({...inherited, confidence:'High', basis:'Confirmed managed rule'}, {}, []);
assert.equal(result.confidence, 'High');
assert.equal(result.manualCheck, false);

const rules = [{id:'example',sport:'cricket',match:{exact:['Example domestic competition']},dazn:'RC E',quinnbet:'RC E',basis:'Managed rule'}];
const index = buildRuntimeIndex({deterministicRules:{rules},resultTransforms:[{id:'example-transform',match:{any:['example']},brandMap:{'RC E':'RC C'}}]});
const classified = classifyDeterministic({sport:'Cricket',competition:'Example domestic competition'},index);
assert.equal(classified.dazn, 'RC C');
assert.equal(classified.quinnbet, 'RC C');
assert.equal(Object.hasOwn(classified, 'nti'), false);

const app = readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pipeline = readFileSync(new URL('../functions/api/analyze-core.js',import.meta.url),'utf8');
assert.doesNotMatch(app, /\bnti\b/i);
assert.doesNotMatch(html, /\bnti\b/i);
assert.doesNotMatch(pipeline, /\bnti\b/i);
console.log('active-brand schema, confidence, transform and export smoke tests passed');
