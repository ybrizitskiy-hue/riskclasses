# Shared AI Project Handoff

## Current checkpoint — 2026-11-18

- PR #26 merged as `c044f70ee089173576b9f979bf67ec26b0a89bc1`; Cloudflare Pages
  production deployment `b2f70db2-8dcc-4cf5-8864-e20a3268832d` succeeded.
  Auto routes to Compatible provider 4 (`deepseek-v4.1-flash`), and v29 is live.
- Production configuration before and after PR #26 matched: `RISK_RULES` KV,
  compatibility date/flags, and the same six configured secret names including
  `TAVILY_API_KEY`. Secret values were not read. The no-delta comparison also
  applies to the current timeout-only candidate.
- A live PGL Wallachia Season 8 request succeeded through Auto/Provider 4 and
  returned the verified Liquipedia page with RC A for ES, DE and UK. The live
  five-event batch exhausted four 30-second attempts. Gateway evidence includes
  a successful DeepSeek request with 94,633 input tokens and 42.861 seconds of
  latency, showing that the 30-second attempt ceiling was too short.
- Current candidate branch `codex/provider4-latency-budget` is based on
  `c044f70ee089173576b9f979bf67ec26b0a89bc1`. It raises each provider attempt
  to 50 seconds and sets bounded analysis/browser deadlines to 240/250 seconds
  so all three retries can finish. Tavily search and provider routing are
  unchanged. Current production rollback reference is deployment
  `b2f70db2-8dcc-4cf5-8864-e20a3268832d`; no new production change is pending.
- Focused chat-web-search and analysis pipeline smoke tests passed. Next action:
  finish PR verification, compare live settings before merge, deploy, verify
  the unchanged settings, then rerun the five-event production batch.

## Previous checkpoint — 2026-11-18 (rules candidate)

- Three-DAZN rules candidate prepared locally from the 2026-11-17 v28 bundle and
  the updated workbook. Branch `codex/three-dazn-brands` is based on
  `3a01222a8684acd077b0d15efc5530bb0cdbc734` (`origin/main`); changes are
  uncommitted and no PR exists.
- The candidate retains all 155 original deterministic rules as provenance,
  supplies explicit mapping evidence per active rule, and keeps the approved
  result policies/transforms. The candidate validates as 156 active rules with
  zero unresolved mappings. The local audit includes every mapping and records
  113 current matrix rows, four documented exclusions, and the user-confirmed
  Table Tennis split. Candidate and audit files remain outside Git under the
  task workspace `tmp/`; they are not production configuration.
- Legacy migration is fail-closed: an old single-DAZN value without an
  evidenced Global mapping, or with a conflicting brand override, remains
  unchanged and fails validation. Ambiguous history snapshots cannot be
  restored automatically.
- The provider test now checks a Liquipedia citation and reports the cited URL;
  repository smoke tests passed. Live provider 4 access to Liquipedia remains
  unverified because the signed-in live test path only performs a generic
  lookup. No provider configuration, routing, Pages KV, or production traffic
  was changed.
- Exact rollback reference is base commit `3a01222a8684acd077b0d15efc5530bb0cdbc734`.
  Next action: review the local candidate and audit; run the strict provider test
  against the authenticated runtime before making any production change.

## Previous checkpoint — 2026-11-06

- 2026-11-06 OpenCode Go session header: `riskclasses` Cloudflare
  provider/custom profiles now send a per-analysis session id in a configurable
  header. The default header is `x-opencode-session`; the value is a fresh
  `ses_<id>` generated once per `/api/analyze` request and reused across
  extraction, primary, research and escalation calls. The provider test uses a
  fresh id as well. This fixes OpenCode Go's
  `Request is missing x-opencode-session` response when a custom provider
  points at `https://opencode.ai/inference/go/openai/v1/chat/completions`.
  Existing `ai-provider-config-v1` profiles receive the default on load, so no
  republish is required before testing. Docs: `README.md` (AI Provider Manager
  → session header). Raw OpenCode Go keys remain in Cloudflare AI Gateway
  Provider Keys/BYOK.
