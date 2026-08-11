# Risk Class Analyst — DAZN / Quinnbet / NTI

Cloudflare Pages application for internal sportsbook risk-class classification. It accepts screenshots or pasted Sport + Competition rows and returns DAZN, Quinnbet and NTI results using the approved risk-class rules.

## Security design

The repository is public, so the internal risk-class dataset is **not committed to GitHub**. The complete canonical rules bundle lives server-side in Cloudflare KV under `RISK_RULES` → `custom-gpt-v2`.

AI provider credentials are never stored in browser code, GitHub, the rules bundle, or provider configuration KV. Direct OpenAI can use the Pages secret `OPENAI_API_KEY`. Alternative providers should use Cloudflare AI Gateway BYOK/Provider Keys so the upstream key remains in Cloudflare Secrets Store.

Routing administration, Rules Manager, AI Provider Manager and cost telemetry are protected by `RISK_ADMIN_PIN`. The admin endpoint issues an 8-hour `HttpOnly; Secure; SameSite=Strict` signed cookie. A dedicated `RISK_ADMIN_SIGNING_SECRET` is recommended so admin sessions are independent of whichever AI provider is active.

Protect the production hostname with Cloudflare Access for RokkerX users as the outer access-control layer.

## One managed rules source

`custom-gpt-v2` is the single source of truth for both AI classification and deterministic exact-rule classification. The managed bundle contains:

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

Older `custom-gpt-v2` values containing only `version`, `instructions` and `knowledge` are migrated automatically on first use. The deterministic engine contains matching mechanics only; its DAZN / Quinnbet / NTI values, patterns and basis text are read from the KV bundle.

## Rules Manager

Unlock **Admin** with the configured PIN and click **Manage rules**.

1. **Download current JSON** — exports the complete portable rules bundle plus an `editorGuide` prompt.
2. Upload it to any GPT and describe the required change.
3. Ask for the **complete updated JSON**, preserving unrelated content.
4. Import the updated file in Rules Manager.
5. The server validates it and shows a diff before Publish is enabled.
6. Click **Publish globally**. New analyses use the new KV rules without a redeploy.
7. Previous bundles are archived automatically; use **Rollback** to restore a snapshot.

Rules Manager blocks malformed/truncated bundles, duplicate deterministic IDs, missing DAZN/QB/NTI values, invalid RC values/regexes, and changes that break the active Tennis SRL H/H/H operational override.

Up to 20 previous rules snapshots are retained under `rules-history:*`, indexed by `rules-history-index-v1`.

## AI Provider Manager

Unlock **Admin** and click **AI providers**. Provider configuration is global and is saved in `RISK_RULES` under `ai-provider-config-v1`.

Raw provider keys are **not** editable in the website. Store them in Cloudflare AI Gateway → Provider Keys (BYOK). The website stores only the BYOK alias used to select a key.

### Provider transports

- **Direct OpenAI** — backwards-compatible direct calls to `api.openai.com` using `OPENAI_API_KEY`.
- **Cloudflare REST / Unified** — OpenAI-compatible Cloudflare `/ai/v1/responses` or `/ai/v1/chat/completions`; model names are configured in the profile.
- **Cloudflare provider/custom** — provider-native AI Gateway URL. Supports native provider slugs and `custom-*` OpenAI-compatible providers.

Each profile contains:

- display label and stable profile ID;
- transport and protocol (`responses` or `chat-completions`);
- exact model name;
- Cloudflare provider slug;
- optional managed HTTPS Base URL for `custom-*` providers;
- provider path prefix (commonly `v1`);
- BYOK alias;
- capability flags: Vision, JSON Schema, Reasoning, Web Search, Prompt Cache, `store:false` support;
- optional input/cached/output/search pricing used only for approximate telemetry.

The provider adapter only sends optional API fields that the profile declares as supported. Generic Chat Completions profiles do not receive the OpenAI Responses `web_search` tool. If a classification needs current research and the primary profile has no compatible web-search capability, it can set `needsEscalation` and the configured research/escalation provider can review it.

### Managed custom-provider addresses

For an OpenAI-compatible provider that is not built into Cloudflare:

1. Create a profile with transport **Cloudflare provider/custom**.
2. Use a provider slug beginning with `custom-`, for example `custom-example`.
3. Enter its HTTPS **Base URL**, for example `https://api.example.com`.
4. Put API-specific path components such as `v1` into **Provider path prefix**, not the Base URL.
5. If `CF_AI_GATEWAY_ADMIN_TOKEN` is configured, **Sync address** or Publish creates/updates the Cloudflare Custom Provider automatically.
6. The actual upstream API key is still stored separately in Cloudflare Provider Keys/BYOK.

Changing an already-managed Base URL is synchronized to Cloudflare before the new global provider configuration is saved. A failed address synchronization blocks Publish so KV cannot claim an address change that Cloudflare did not accept.

### Global provider routes

Auto / Economy / Quality no longer depend on hardcoded provider names. Each mode has four roles:

- **Extraction** — screenshot → exact Sport + Competition rows; must support Vision.
- **Primary** — first classification for non-deterministic rows.
- **Research** — optional review stage for unresolved/current-fact cases.
- **Escalation** — optional final stronger model.

The default provider config exactly preserves the previous behavior:

- Economy: OpenAI Luna extraction/classification, no escalation.
- Auto: OpenAI Luna extraction/classification → OpenAI Terra on material uncertainty.
- Quality: OpenAI Luna extraction → OpenAI Terra classification.

After an admin publishes a new provider config, every user uses the new global routes after KV propagation; no code deploy is needed.

### Provider Test

Each profile has a **Test** button that sends a small structured-output request through its configured transport. Managed custom providers synchronize their Base URL first when the admin token is available. Use Test before assigning a new provider to a production route.

## Globally managed routing mode

There is one routing mode for the whole website, stored in `RISK_RULES` under `runtime-config-v1`.

An unlocked admin chooses **Auto**, **Economy**, or **Quality**. The selected mode applies to all users. Every `/api/analyze` request is rewritten server-side to the current global mode, so browser-supplied routing values are not authoritative. Cost telemetry remains admin-only.

## Deterministic engine

The deterministic layer is conservative. High-volume approved mappings such as ITF/World Tennis Tour tennis, UTR, Challenger doubles, Tennis SRL, explicit Golf categories, selected Table Tennis and Badminton categories, MMA Contender Series, and exact Football RC I list matches can be resolved without a classification-model call.

The actual pattern/value definitions live in the managed rules KV bundle. If a case is not safely matched, it is routed to the configured AI profile rather than guessed.

## Confidence contract

The server enforces:

- High → Manual check No
- Medium → Manual check Yes
- Low → Manual check Yes
- any `RC X rec.` cannot be High
- any `Manual check / missing rule` forces Low

Tennis Virtuals / SRL / Simulated Reality remain RC H for DAZN, Quinnbet and NTI while the not-offered operational exception is active.

## Cloudflare Pages setup

### Existing / base secrets

- `RISK_ADMIN_PIN` — admin PIN.
- `OPENAI_API_KEY` — required only while one or more active routes use **Direct OpenAI**. It also remains a backwards-compatible admin-session signing fallback.
- `RISK_ADMIN_SIGNING_SECRET` — **recommended** high-entropy secret (32+ random bytes/characters) used only to sign admin sessions. Once set, admin access no longer depends on the OpenAI key.

### Cloudflare AI Gateway secrets

- `CF_AI_GATEWAY_TOKEN` — inference/runtime token. Required when any active profile uses Cloudflare REST or provider-native/custom AI Gateway routing.
- `CF_AI_GATEWAY_ADMIN_TOKEN` — optional but required to manage/synchronize `custom-*` Base URLs from the website. Give it AI Gateway Edit/Write permission; keep it separate from the runtime token where possible.

After adding or changing a Pages secret, redeploy Production.

### Cloudflare account/gateway identifiers

Account ID and Gateway ID may be entered directly in **Admin → AI providers**, so no environment variable is required. Optional environment fallbacks are supported:

- `CF_ACCOUNT_ID`
- `CF_AI_GATEWAY_ID`

### Required KV binding

- Binding variable: `RISK_RULES`
- Canonical rules: `custom-gpt-v2`
- Global routing mode: `runtime-config-v1`
- AI provider config: `ai-provider-config-v1` (created by AI Provider Manager)
- Rules history index: `rules-history-index-v1`
- Rules history snapshots: `rules-history:*`

Do not manually put AI provider API keys in this KV namespace.

### Legacy model overrides

These only affect the automatically generated default Direct OpenAI profiles before a managed provider config is published:

- `OPENAI_EXTRACT_MODEL` — default `gpt-5.6-luna`
- `OPENAI_LUNA_MODEL` — default `gpt-5.6-luna`
- `OPENAI_TERRA_MODEL` — default `gpt-5.6-terra`

Once `ai-provider-config-v1` exists, edit models/routes in AI Provider Manager instead.

## Admin API

- `GET /api/admin` — admin/session state + global routing mode.
- `POST /api/admin` — PIN unlock.
- `PUT /api/admin` — change global Auto/Economy/Quality mode.
- `DELETE /api/admin` — clear admin session without changing global mode.

## Rules API

All Rules API routes require a valid admin session.

- `GET /api/rules` — current managed bundle, validation, GPT guide and history metadata.
- `POST /api/rules` — validate/diff an imported candidate without changing production.
- `PUT /api/rules` `action: "publish"` — archive then publish candidate.
- `PUT /api/rules` `action: "rollback"` — archive current then restore history snapshot.

## Provider API

All Provider API routes require a valid admin session.

- `GET /api/providers` — provider config, validation and secret-readiness booleans; never secret values.
- `POST /api/providers` `action: "validate"` — validate a draft config.
- `POST /api/providers` `action: "test"` — run a small provider connectivity/structured-output test.
- `POST /api/providers` `action: "sync"` — synchronize one managed custom-provider Base URL to Cloudflare.
- `PUT /api/providers` `action: "publish"` — synchronize changed managed addresses when necessary, then save the global provider config to KV.

## Regression tests

Node 22+:

```bash
node tests/routing-smoke.mjs
node tests/admin-gate-smoke.mjs
node tests/rules-manager-smoke.mjs
node tests/provider-manager-smoke.mjs
```

GitHub Actions runs syntax checks and regression suites on pull requests and pushes to `main`. Coverage includes deterministic workflows, zero-model text classification, image extraction, global routing, confidence guards, PIN/session behavior, rules publish/history/rollback, direct OpenAI compatibility, Cloudflare REST routing, Responses/Chat Completions adapters, BYOK alias headers, provider pricing telemetry, and Cloudflare Custom Provider address create/update synchronization.
