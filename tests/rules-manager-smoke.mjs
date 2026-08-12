import { baselineDeterministicRules, diffRulesBundles, preparePublishedBundle, validateRulesBundle } from '../functions/lib/rules-bundle.js';
let checks=0;
const base={schemaVersion:1,version:'v1',instructions:`Rules JSON is sole authority. ${'Preserve managed rules. '.repeat(40)}`,knowledge:`Knowledge. ${'Managed sportsbook rule knowledge. '.repeat(150)}`,deterministicRules:{engineVersion:2,rules:[{id:'r1',sport:'golf',match:{any:['\\bpga tour\\b'],all:[],none:[]},dazn:'RC B',quinnbet:'RC B',nti:'RC B',basis:'managed',source:'Managed JSON'}]},resultPolicies:[],resultTransforms:[]};
let v=validateRulesBundle(base); assert(v.valid,'Complete managed JSON must validate');
assert(baselineDeterministicRules().rules.length===0,'Code baseline must have zero sportsbook mappings');
const empty=structuredClone(base); empty.deterministicRules.rules=[]; v=validateRulesBundle(empty); assert(!v.valid&&v.errors.some(x=>x.includes('fallback RC mappings')),'Empty managed rules must fail rather than receive code fallbacks');
const next=structuredClone(base); next.version='v2'; next.deterministicRules.rules[0].dazn='RC C'; next.resultPolicies=[{id:'p1',confidences:['High'],sports:['Tennis'],field:'competition',whenMissingPatterns:['\\bq[1-4]\\b'],manualCheck:true,manualCheckType:'Stage',reason:'Stage check'}];
v=validateRulesBundle(next); assert(v.valid,'Managed resultPolicies must validate');
const diff=diffRulesBundles(base,next); assert(diff.changed&&diff.deterministic.changed.includes('r1')&&diff.resultPoliciesChanged,'Diff must report rule and policy changes');
const prepared=preparePublishedBundle(next,base); assert(prepared.schemaVersion===1&&prepared.version==='v2'&&prepared.updatedAt,'Publish preparation must preserve data and stamp update');
const bad=structuredClone(next); bad.deterministicRules.rules[0].providers=['Betgenius']; v=validateRulesBundle(bad); assert(!v.valid&&v.errors.some(x=>x.includes('provider sentinel')),'Provider rule without legacy-safe sentinel must fail');
console.log(`rules manager smoke tests passed (${checks} checks)`);
function assert(v,m){checks++;if(!v)throw new Error(m);}
