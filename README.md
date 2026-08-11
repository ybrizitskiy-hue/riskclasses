# Risk Class Analyst — DAZN / Quinnbet / NTI

Cloudflare Pages application for internal sportsbook risk-class classification. It accepts screenshots or pasted Sport + Competition rows and returns DAZN, Quinnbet and NTI results using the same v2 instructions and canonical knowledge source as the approved Custom GPT.

## Security design

This repository is public, so the internal risk-class dataset is deliberately **not committed to GitHub**. The complete Custom GPT instructions + knowledge source are stored server-side in a Cloudflare KV value and are read only by the Pages Function.

The OpenAI API key is server-side only as the Pages secret `OPENAI_API_KEY`. It is never sent to the browser. Protect the production hostname with Cloudflare Access for RokkerX users.

AI routing mode and cost telemetry are additionally protected by a server-side admin PIN. The PIN itself must be stored only as the Cloudflare secret `RISK_ADMIN_PIN`; do not commit the PIN to this public repository.

The admin endpoint issues an 8-hour `HttpOnly; Secure; SameSite=Strict` signed session cookie. The signature is HMAC-SHA256 and derives high entropy from the server-side OpenAI secret plus the admin PIN. Non-admin requests are forced to Auto routing server-side and any cost telemetry is stripped from the API response, so hiding the controls in the browser is not the only protection.

## Cost-optimized routing

Normal team users always use **Auto**. After admin PIN unlock, the UI exposes three operating modes while keeping the same risk-class rules and confidence contract:

- **Auto — default/recommended:** screenshots are read with GPT-5.6 Luna / Low. Exact deterministic rules are applied without a classification-model call. Unresolved rows go to GPT-5.6 Luna / Medium. Only rows where Luna says the underlying competition/base classification remains materially uncertain are escalated to GPT-5.6 Terra / Medium.
- **Economy — admin only:** screenshots still use Luna / Low extraction and exact deterministic rules. All unresolved rows use Luna / Medium only; there is no Terra escalation.
- **Quality — admin only:** screenshots use Luna / Low extraction and exact deterministic rules. All unresolved rows go directly to Terra / Medium.

A missing brand-specific rule or an `RC X rec.` result by itself does **not** trigger Auto escalation. Those cases remain Medium/Yes or Low/Yes according to the approved Custom GPT contract.

The server uses OpenAI prompt caching with a stable cache key and 24-hour retention for the large canonical rules prompt. Web search is available only on unresolved classification calls and is capped at three tool calls per model request. Screenshot extraction has no web-search tool.

Cost telemetry is returned only to an authenticated admin session and includes:

- deterministic row count;
- AI-classified row count;
- escalated row count;
- models used;
- input/cached/output/reasoning tokens;
- web-search calls;
- estimated USD cost;
- cache-write ceiling estimate.

## Deterministic exact-rule layer

Only approved high-confidence patterns are resolved without classification AI. Current coverage includes high-volume cases such as:

- Tennis ITF / World Tennis Tour main draw, qualification and doubles;
- Tennis UTR / UTR PTT;
- Challenger doubles;
- Tennis SRL / Simulated Reality operational H/H/H exception;
- Golf events whose category is explicit in the name (PGA Tour, DP World Tour, LIV, Golf Majors/Ryder Cup, Korn Ferry, LPGA, PGA Tour Champions) plus the approved Boeing Classic precedent;
- WTT Feeder / WTT Star Contender / Singapore Smash RC D cases;
- selected exact Badminton categories and Malaysia International;
- MMA Contender Series;
- exact matches from the canonical Football RC I list loaded from the private KV knowledge source.

If a deterministic rule is not safe, the row is deliberately routed to Luna/Terra instead of being guessed.

## Confidence contract

The server and browser both enforce:

- High -> Manual check No
- Medium -> Manual check Yes
- Low -> Manual check Yes
- Any `RC X rec.` cannot be High
- Any `Manual check / missing rule` forces Low

Tennis Virtuals / SRL / Simulated Reality remain RC H for DAZN, Quinnbet and NTI while the not-offered operational exception is active.

## Cloudflare Pages setup

Deploy through Cloudflare Pages Git integration because the repository contains Pages Functions.

### Required secrets

- `OPENAI_API_KEY`
- `RISK_ADMIN_PIN` — the approved admin PIN, stored as a Cloudflare Secret only

After adding or changing `RISK_ADMIN_PIN`, redeploy Production.

### Required KV binding

- Variable name: `RISK_RULES`
- KV key: `custom-gpt-v2`

The KV value must be JSON:

```json
{
  "version": "2026-08-11-v2",
  "instructions": "<contents of INSTRUCTIONS_ONLY.txt>",
  "knowledge": "<contents of RISK_CLASS_CUSTOM_GPT_SOURCE.md>"
}
```

Do not commit that payload to this public repository.

### Optional model overrides

No model environment variables are required. Defaults are already configured in code.

Optional overrides:

- `OPENAI_EXTRACT_MODEL` — default `gpt-5.6-luna`
- `OPENAI_LUNA_MODEL` — default `gpt-5.6-luna`
- `OPENAI_TERRA_MODEL` — default `gpt-5.6-terra`

The old generic `OPENAI_MODEL` / `Model` variable is not used by the optimized router.

## Admin behavior

### `GET /api/admin`

Returns only whether the admin PIN is configured and whether the current browser has a valid admin session. It never returns the PIN.

### `POST /api/admin`

Accepts:

```json
{ "pin": "<admin PIN>" }
```

A successful unlock sets the signed HttpOnly admin cookie for eight hours.

### `DELETE /api/admin`

Locks admin controls and clears the admin cookie.

### `/api/analyze` protection

`functions/api/_middleware.js` checks the signed admin session for every analyze request.

- Non-admin: `routingMode` is forcibly replaced with `auto`; response telemetry/cost fields are removed.
- Admin: selected Auto/Economy/Quality mode is allowed and telemetry is returned.

This means manually editing browser JavaScript or sending a direct POST does not bypass the PIN gate.

## Endpoints

### `GET /api/meta`

Reports readiness and routing configuration without exposing the API key or private rules.

### `POST /api/analyze`

Example:

```json
{
  "mode": "image",
  "routingMode": "auto",
  "images": ["data:image/png;base64,..."],
  "text": ""
}
```

The normal result table remains:

`Sport | Competition | DAZN | Quinnbet | NTI | Basis | Confidence | Sources | Manual check`

Cost telemetry is present only for an unlocked admin session.

## Regression tests

With Node 18+:

```bash
node tests/routing-smoke.mjs
node tests/admin-gate-smoke.mjs
```

The routing suite covers deterministic Tennis/Golf/Table Tennis/Badminton/MMA/Football rules, zero-model text routing, Luna Low image extraction, Economy Luna routing, Auto Terra escalation, Quality Terra routing, and the `rec. -> Medium/Yes` guard.

The admin suite covers PIN verification, signed admin session cookies, forced Auto mode for non-admin requests, telemetry stripping for non-admin requests, and retained mode/telemetry for admin requests.

## Updating rules later

Update the approved Custom GPT source files, rebuild the KV payload, replace `custom-gpt-v2`, and run the same regression cases used for the Custom GPT. Do not weaken confidence/manual-check behavior in ad-hoc prompt fragments.
