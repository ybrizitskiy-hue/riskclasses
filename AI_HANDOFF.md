# Shared AI Project Handoff

## Current checkpoint — 2026-11-18

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
