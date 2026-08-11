# Risk Class Analyst — DAZN / Quinnbet / NTI

Cloudflare Pages application for internal sportsbook risk-class classification. It accepts screenshots or pasted Sport + Competition rows and returns DAZN, Quinnbet and NTI results using the approved risk-class rules.

## Security design

The repository is public, so the internal risk-class dataset is **not committed to GitHub**. The complete canonical rules bundle lives server-side in Cloudflare KV under `RISK_RULES` → `custom-gpt-v2`.

The OpenAI API key is server-side only as `OPENAI_API_KEY`. Protect the production hostname with Cloudflare Access for RokkerX users.

Routing administration, Rules Manager and cost telemetry are protected by `RISK_ADMIN_PIN`. The admin endpoint issues an 8-hour `HttpOnly; Secure; SameSite=Strict` signed cookie. The PIN is never embedded in browser code or committed to GitHub.

## One managed rules source

`custom-gpt-v2` is now the single source of truth for both AI classification and deterministic exact-rule classification. The managed bundle contains:

```json
{
  "schemaVersion": 1,
  "version": "...",
  "instructions": "...",
  "knowledge": "...",
  "deterministicRules": {
    "engineVersion": 1,
    "footballRcI": { "...": "..." },
    "rules": ["..."]
  }
}
```

Older `custom-gpt-v2` values containing only `version`, `instructions` and `knowledge` are migrated automatically on first use. The migration adds the current approved deterministic definitions and persists the managed schema back to KV.

The deterministic engine contains matching mechanics only; its DAZN / Quinnbet / NTI values, patterns and basis text are read from the KV bundle. Future rule-value changes therefore do not require a GitHub deployment when they are made through Rules Manager.

## Rules Manager

Unlock **Admin** with the configured PIN and click **Manage rules**.

The workflow is:

1. **Download current JSON** — exports a complete portable rules bundle plus an `editorGuide` prompt.
2. Upload that JSON to any GPT and describe the required rule change.
3. Ask the GPT to return the **complete updated JSON**, preserving unrelated content.
4. In Rules Manager, choose the updated JSON.
5. The server validates it and shows a change summary before Publish is enabled.
6. Click **Publish globally**. New analyses immediately use the new KV rules; no redeploy is required.
7. Previous bundles are archived automatically. Use **Rollback** to restore an earlier snapshot.

The exported GPT editing guide requires the model to preserve the complete bundle, keep `schemaVersion=1`, preserve unrelated rules, keep all three brands in deterministic mappings, and retain the hard confidence/manual-check doctrine.

### Publish validation

Rules Manager blocks publishing when, among other checks:

- the JSON/schema is malformed;
- instructions or knowledge are unexpectedly missing/truncated;
- deterministic rule IDs are duplicated;
- a deterministic rule lacks DAZN, Quinnbet or NTI;
- a deterministic value is not RC A–I;
- a deterministic matcher regex is invalid;
- the mandatory `tennis-srl` operational override is missing or is not H/H/H.

It also warns when important doctrine text cannot be detected automatically.

### Version history

Before every publish or rollback, the current canonical bundle is archived in KV. Up to 20 recent snapshots are retained through the history index `rules-history-index-v1`. Snapshot values use `rules-history:*` keys.

Publishing a file with the same version name as the current bundle automatically receives a timestamp revision suffix so prompt-cache keys and audit history do not ambiguously reuse a changed version.

## Globally managed cost routing

There is one routing mode for the whole website, stored in `RISK_RULES` under `runtime-config-v1`.

An unlocked admin can choose:

- **Auto — recommended:** Luna Low screenshot extraction, deterministic exact rules, Luna Medium for unresolved rows, Terra Medium only for material classification uncertainty.
- **Economy:** Luna Low extraction, deterministic exact rules, Luna Medium for unresolved rows, no Terra escalation.
- **Quality:** Luna Low extraction, deterministic exact rules, Terra Medium for every unresolved row.

The selected mode applies to **all users**. Every `/api/analyze` request is rewritten server-side to the current global mode. Normal users cannot change it. Cost telemetry remains admin-only.

A missing brand-specific rule or `RC X rec.` alone does not trigger Auto escalation. Those cases remain Medium/Yes or Low/Yes according to the approved contract.

The server uses a stable OpenAI prompt-cache key with 24-hour retention for the large canonical prompt. Web search is available only for unresolved AI classification and is capped at three tool calls per model request. Screenshot extraction has no web-search tool.

## Deterministic engine

The deterministic layer is conservative: only approved exact/high-confidence patterns are handled locally. The current managed baseline includes high-volume cases such as ITF/World Tennis Tour tennis, UTR, Challenger doubles, Tennis SRL, explicit Golf categories, selected Table Tennis and Badminton categories, MMA Contender Series, and exact Football RC I list matches.

The actual pattern/value definitions live in the KV bundle rather than in the engine code. If a case is not safely matched, it is routed to Luna/Terra rather than guessed.

## Confidence contract

The server enforces:

- High → Manual check No
- Medium → Manual check Yes
- Low → Manual check Yes
- any `RC X rec.` cannot be High
- any `Manual check / missing rule` forces Low

Tennis Virtuals / SRL / Simulated Reality remain RC H for DAZN, Quinnbet and NTI while the not-offered operational exception is active.

## Cloudflare Pages setup

### Required secrets

- `OPENAI_API_KEY`
- `RISK_ADMIN_PIN`

After adding/changing a secret, redeploy Production.

### Required KV binding

- Binding variable: `RISK_RULES`
- Canonical rules: `custom-gpt-v2`
- Global routing: `runtime-config-v1` (created automatically)
- Rules history index: `rules-history-index-v1` (created automatically)
- History snapshots: `rules-history:*` (created automatically)

After the initial setup, do **not** manually edit KV for normal rule changes; use the PIN-protected Rules Manager so validation/history/rollback are preserved.

### Optional model overrides

- `OPENAI_EXTRACT_MODEL` — default `gpt-5.6-luna`
- `OPENAI_LUNA_MODEL` — default `gpt-5.6-luna`
- `OPENAI_TERRA_MODEL` — default `gpt-5.6-terra`

The old generic `OPENAI_MODEL` / `Model` variable is not used by the optimized router.

## Admin API

- `GET /api/admin` — admin/session state + global routing mode.
- `POST /api/admin` — PIN unlock.
- `PUT /api/admin` — change global Auto/Economy/Quality mode.
- `DELETE /api/admin` — clear admin session without changing global mode.

## Rules API

All Rules API routes require a valid admin session.

- `GET /api/rules` — returns the current managed bundle, validation report, GPT guide and history metadata. It also migrates the legacy bundle if needed.
- `POST /api/rules` — validates an imported candidate and returns a diff without changing production.
- `PUT /api/rules` with `action: "publish"` — validates, archives current, then publishes candidate.
- `PUT /api/rules` with `action: "rollback"` — archives current, then restores the selected history snapshot.

## Regression tests

Node 20+:

```bash
node tests/routing-smoke.mjs
node tests/admin-gate-smoke.mjs
node tests/rules-manager-smoke.mjs
```

GitHub Actions runs all three suites on pull requests and pushes to `main`.

Coverage includes deterministic Tennis/Golf/Table Tennis/Badminton/MMA/Football behavior, zero-model deterministic routing, Luna/Terra routing modes, confidence guards, global admin mode enforcement, PIN/session behavior, legacy bundle migration, bundle validation, data-driven deterministic changes, publish/history and rollback.
