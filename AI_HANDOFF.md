# Shared AI Project Handoff

## Current checkpoint — 2026-11-18

- Provider timeout retry and Tavily-only search changes are in PR #26,
  `codex/provider4-timeout-retries`, based on `f5264d8ac35cf853b42dedbefffaed1388175219`.
  Source commit `51aeb8b928439cf253487f895f0f601580b8f97d` passed the local PR
  verification suite and GitHub's `PR verification gate`, `Regression tests`,
  and `Risk Class smoke tests` before this handoff update.
- Provider attempts have a 30-second deadline and retry up to three times. The
  analysis/browser deadlines are 160/170 seconds. Compatible provider 4's native
  Web Search capability is disabled for its Chat Completions/native profile;
  Tavily still searches Liquipedia and DeepSeek receives the retrieved evidence.
- Production was not changed. The active Pages version and live provider/KV
  configuration could not be captured in this background session because the
  Wrangler CLI/login and authenticated Cloudflare Admin API are unavailable.
  The planned runtime difference is only provider 4's native Web Search flag;
  compare the actual settings before promotion. Rollback source is
  `f5264d8ac35cf853b42dedbefffaed1388175219`.
- Next action: capture the active Pages version and runtime settings, compare
  them with the intended flag change, then promote and run the authenticated
  provider 4 Liquipedia check if the comparison is clean.

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
