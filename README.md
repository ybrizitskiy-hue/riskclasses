# Risk Class Analyst — DAZN / Quinnbet / NTI

Cloudflare Pages application for internal sportsbook risk-class classification. It accepts screenshots or pasted Sport + Competition rows and returns DAZN, Quinnbet and NTI results using the same v2 instructions and canonical knowledge source as the approved Custom GPT.

## Security design

This repository is public, so the internal risk-class dataset is deliberately **not committed to GitHub**. The complete Custom GPT instructions + knowledge source are stored server-side in a Cloudflare KV value and are read only by the Pages Function.

The OpenAI API key is also server-side only as the Pages secret `OPENAI_API_KEY`. It is never sent to the browser.

## Runtime behavior

- Model: `gpt-5.6-terra` by default (`OPENAI_MODEL` may override it).
- Reasoning effort: `medium`.
- Same v2 Custom GPT instructions and full knowledge dataset at runtime.
- Web search is available to the model but the prompt requires exact knowledge rules to be used before research.
- Screenshot competition names must remain exactly as shown.
- Multiple screenshots remove only obvious exact boundary-overlap duplicates.
- All normal results include DAZN, Quinnbet and NTI.
- Hard confidence contract:
  - High -> Manual check No
  - Medium -> Manual check Yes
  - Low -> Manual check Yes
  - Any `RC X rec.` cannot be High
  - Any `Manual check / missing rule` forces Low
- Tennis Virtuals / SRL / Simulated Reality: RC H for DAZN, Quinnbet and NTI while the not-offered operational exception remains active.

The API also applies a server-side consistency guard after model output, and the browser applies the same guard again before rendering.

## Cloudflare Pages setup

This repository uses Pages Functions in `functions/`, so deploy through Cloudflare Pages Git integration.

### 1. OpenAI secret

In the Pages project, add the encrypted secret:

`OPENAI_API_KEY`

Optional variable:

`OPENAI_MODEL=gpt-5.6-terra`

If the API key is already configured on this same Pages project, keep the existing value. If it currently exists only on a separate Worker, add the same key to the Pages project secret because Pages Functions cannot read another Worker's secret automatically.

### 2. Private rules KV

Create a Workers KV namespace for the internal rules. In the Pages project add a KV binding:

- Variable name: `RISK_RULES`
- Namespace: your private risk-rules KV namespace

The Pages Function reads key:

`custom-gpt-v2`

The value must be JSON with this shape:

```json
{
  "version": "2026-08-11-v2",
  "instructions": "<contents of INSTRUCTIONS_ONLY.txt>",
  "knowledge": "<contents of RISK_CLASS_CUSTOM_GPT_SOURCE.md>"
}
```

Do not commit that payload to this public repository.

To build the payload locally from the approved v2 files:

```bash
node scripts/build-rules-payload.mjs /path/to/INSTRUCTIONS_ONLY.txt /path/to/RISK_CLASS_CUSTOM_GPT_SOURCE.md risk-rules-kv.json
```

Then upload it to the remote KV namespace with Wrangler, using your namespace ID:

```bash
npx wrangler kv key put --namespace-id=YOUR_KV_NAMESPACE_ID "custom-gpt-v2" --path=./risk-rules-kv.json --remote
```

You can also create the KV namespace/binding and edit KV pairs in the Cloudflare dashboard.

After adding or changing a Pages binding, redeploy the Pages project.

### 3. Cloudflare Access

For internal team use, protect the Pages hostname with Cloudflare Access and allow only the intended company/team identities.

## Endpoints

### `GET /api/meta`

Reports whether the Pages Function has both the OpenAI secret and the v2 rules payload configured. It never returns either secret or the rules content.

### `POST /api/analyze`

Request:

```json
{
  "mode": "image",
  "images": ["data:image/png;base64,..."],
  "text": ""
}
```

or:

```json
{
  "mode": "text",
  "images": [],
  "text": "Sport\tCompetition\nTennis\tWT Bydgoszcz. Poland. Women Singles"
}
```

Response rows contain:

`Sport | Competition | DAZN | Quinnbet | NTI | Basis | Confidence | Sources | Manual check`

## UI

The current UI supports:

- drag-and-drop screenshots;
- click-to-upload;
- Ctrl/Cmd + V screenshot paste;
- up to four screenshots per request;
- pasted spreadsheet rows;
- exact-name preservation instructions;
- responsive results table;
- confidence/manual-review indicators;
- table copy;
- CSV export;
- API readiness indicator.

## Updating rules later

Do not change the runtime behavior by editing random prompt fragments in code. Update the approved Custom GPT v2 source files, rebuild the KV payload, replace `custom-gpt-v2`, then run the same regression cases used for the Custom GPT.
