import { readFile, writeFile } from 'node:fs/promises';

const [instructionsPath, knowledgePath, outputPath = 'risk-rules-kv.json'] = process.argv.slice(2);
if (!instructionsPath || !knowledgePath) {
  console.error('Usage: node scripts/build-rules-payload.mjs <INSTRUCTIONS_ONLY.txt> <RISK_CLASS_CUSTOM_GPT_SOURCE.md> [output.json]');
  process.exit(1);
}

const [instructions, knowledge] = await Promise.all([
  readFile(instructionsPath, 'utf8'),
  readFile(knowledgePath, 'utf8'),
]);

const payload = {
  version: '2026-08-11-v2',
  instructions,
  knowledge,
};

await writeFile(outputPath, JSON.stringify(payload), 'utf8');
console.log(`Wrote ${outputPath} (${Buffer.byteLength(JSON.stringify(payload))} bytes)`);
