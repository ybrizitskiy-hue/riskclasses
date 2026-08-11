# Risk Class Analyst — DAZN / Quinnbet / NTI

Cloudflare Pages application for internal sportsbook risk-class classification. It accepts screenshots or pasted Sport + Competition rows and returns DAZN, Quinnbet and NTI results using the same v2 instructions and canonical knowledge source as the approved Custom GPT.

## Security design

This repository is public, so the internal risk-class dataset is deliberately **not committed to GitHub**. The complete Custom GPT instructions + knowledge source are stored server-side in Cloudflare KV and are read only by the Pages Function.

The OpenAI API key is server-side only as the Pages secret `OPENAI_API_KEY`. Protect the production hostname with Cloudflare Access for RokkerX users.

Routing administration and cost telemetry are protected by the Cloudflare secret `RISK_ADMIN_PIN`. The admin endpoint issues an 8-hour `HttpOnly; Secure; SameSite=Strict` signed cookie. The PIN is never embedded in browser code or committed to GitHub.

## Globally managed cost routing

There is one routing mode for the whole website. It is stored server-side in the existing `RISK_RULES` KV namespace under key `runtime-config-v1`.

An unlocked admin can choose:

- **Auto — recommended:** Luna Low screenshot extraction, deterministic exact rules, Luna Medium for unresolved rows, Terra Medium only for material classification uncertainty.
- **Economy:** Luna Low extraction, deterministic exact rules, Luna Medium for unresolved rows, no Terra escalation.
- **Quality:** Luna Low extraction, deterministic exact rules, Terra Medium for every unresolved row.

The selected mode applies to **all users**, not just the browser that changed it. Every `/api/analyze` request is rewritten server-side to the currently configured global mode. Client-supplied `routingMode` values are ignored as an authority.

Normal users do not see the selector and cannot change the mode. They may see the current managed mode label, but cost telemetry remains admin-only.

A missing brand-specific rule or an `RC X rec.` result by itself does **not** trigger Auto escalation. Those cases remain Medium/Yes or Low/Yes according to the approved Custom GPT contract.

The server uses OpenAI prompt caching with a stable cache key and 24-hour retention for the large canonical rules prompt. Web search is available only on unresolved classification calls and is capped at three tool calls per model request. Screenshot extraction has no web-search tool.

## Cost telemetry

Cost telemetry is returned only to a valid admin session and includes:

- deterministic row count;
- AI-classified row count;
- escalated row count;
- models used;
- input/cached/output/reasoning tokens;
- web-search calls;
- estimated USD cost;
- cache-write ceiling estimate.

Non-admin responses have telemetry/cost fields removed server-side.

## Deterministic exact-rule layer

Only approved high-confidence patterns are resolved without classification AI. Current coverage includes high-volume cases such as:

- Tennis ITF / World Tennis Tour main draw, qualification and doubles;
- Tennis UTR / UTR PTT;
- Challenger doubles;
- Tennis SRL / Simulated Reality operational H/H/H exception;
- Golf events whose category is explicit in the name: PGA Tour, DP World Tour, LIV, Golf Majors/Ryder Cup, Korn Ferry, LPGA, PGA Tour Champions, plus the approved Boeing Classic precedent;
- WTT Feeder / WTT Star Contender / Singapore Smash RC D cases;
- selected exact Badminton categories and Malaysia International;
- MMA Contender Series;
- exact matches from the canonical Football RC I list loaded from the private KV knowledge source.

If a deterministic rule is not safe, the row is routed to Luna/Terra rather than guessed.

## Confidence contract

The server and browser enforce:

- High -> Manual check No
- Medium -> Manual check Yes
- Low -> Manual check Yes
- Any `RC X rec.` cannot be High
- Any `Manual check / missing rule` forces Low

Tennis Virtuals / SRL / Simulated Reality remain RC H for DAZN, Quinnbet and NTI while the not-offered operational exception is active.

## Cloudflare Pages setup

### Required secrets

- `OPENAI_API_KEY`
- `RISK_ADMIN_PIN` — approved admin PIN, stored as a Cloudflare Secret only

After adding/changing a secret, redeploy Production.

### Required KV binding

- Variable name: `RISK_RULES`
- Canonical rules key: `custom-gpt-v2`
- Global runtime configuration key: `runtime-config-v1` — created automatically when an admin first changes the mode

The canonical rules value remains:

```json
{
  "version": "2026-08-11-v2",
  "instructions": "<contents of INSTRUCTIONS_ONLY.txt>",
  "knowledge": "<contents of RISK_CLASS_CUSTOM_GPT_SOURCE.md>"
}
```

Do not commit that payload to this public repository.

### Optional model overrides

No model environment variables are required. Defaults are configured in code.

- `OPENAI_EXTRACT_MODEL` — default `gpt-5.6-luna`
- `OPENAI_LUNA_MODEL` — default `gpt-5.6-luna`
- `OPENAI_TERRA_MODEL` — default `gpt-5.6-terra`

The old generic `OPENAI_MODEL` / `Model` variable is not used by the optimized router.

## Admin API

### `GET /api/admin`

Returns whether admin is configured, whether the browser has a valid admin session, and the current `globalRoutingMode`. It never returns the PIN.

### `POST /api/admin`

Unlocks admin controls with the PIN and sets the signed HttpOnly cookie.

### `PUT /api/admin`

Requires an unlocked admin session. Accepts:

```json
{ "routingMode": "auto" }
```

Allowed values: `auto`, `economy`, `quality`. The setting is persisted to KV and becomes the server-enforced mode for everyone.

### `DELETE /api/admin`

Clears the admin session cookie. It does **not** change the global routing mode.

## Analyze protection

`functions/api/_middleware.js` reads the current global mode from KV for every analyze request and replaces any client-provided routing value with it.

- Everyone uses the same server-controlled mode.
- Admin status does not change which mode the request uses; it only grants permission to change the global setting and see telemetry.
- Non-admin responses have cost telemetry removed.

## Regression tests

With Node 18+:

```bash
node tests/routing-smoke.mjs
node tests/admin-gate-smoke.mjs
```

The routing suite covers deterministic Tennis/Golf/Table Tennis/Badminton/MMA/Football rules, zero-model text routing, Luna Low image extraction, Economy Luna routing, Auto Terra escalation, Quality Terra routing, and the `rec. -> Medium/Yes` guard.

The admin suite verifies PIN handling, signed sessions, default Auto global mode, global Quality changes, server-side override of client routing values, and telemetry hiding for non-admin users.

## Updating rules later

Update the approved Custom GPT source files, rebuild the KV payload, replace `custom-gpt-v2`, and run the same regression cases used for the Custom GPT. Do not weaken confidence/manual-check behavior in ad-hoc prompt fragments.
