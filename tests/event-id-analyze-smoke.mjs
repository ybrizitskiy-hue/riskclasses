import { readFileSync } from 'node:fs';
import { decorateInputRows, parseCompetitionRows } from '../functions/lib/input-contract.js';
let checks=0;
const rows=decorateInputRows(parseCompetitionRows('Sport\tCompetition\tCompetition ID\nTennis\tATP Challenger Example\tBG-42\nSnooker\tWorld Championship\tU-99'));
assert(rows.length===2,'Pipeline parser must keep both rows');
assert(rows[0].competitionId==='BG-42'&&rows[0].dataProvider==='Betgenius','BG ID must decorate as Betgenius');
assert(rows[1].competitionId==='U-99'&&rows[1].dataProvider==='Betradar','U ID must decorate as Betradar');
const src=readFileSync(new URL('../functions/api/analyze-core.js',import.meta.url),'utf8');
assert(src.includes("required: ['sport', 'competition', 'competitionId']"),'Extraction schema must require Competition ID');
assert(src.includes("'manualCheckType'"),'Classifier schema must carry managed review label');
assert(src.includes('rulesPayload.resultPolicies'),'Analysis must pass managed resultPolicies to policy evaluator');
assert(src.includes('resultTransforms: Array.isArray(rules.resultTransforms)'),'AI prompt must receive managed transforms');
assert(src.includes('managed JSON above is the sole sportsbook rule authority'),'AI routing contract must state JSON authority');
assert(!src.includes('PROVIDER_TENNIS_RULES_PROMPT'),'Analyze core must not import hard-coded provider Tennis rules');
assert(!/Betradar: Global RC|Betgenius main draw\/non-qualification: Global RC/.test(src),'Analyze core must not embed provider Tennis RC matrix');
console.log(`event ID analysis contract smoke tests passed (${checks} checks)`);
function assert(v,m){checks++;if(!v)throw new Error(m);}
