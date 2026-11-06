# Shared AI Project Handoff

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
