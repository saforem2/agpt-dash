# Lessons

- When the integrated desktop browser is unavailable, fall back to a locally installed Playwright or browser CLI instead of treating visual verification as blocked.
- When an existing server keeps HTML in process memory but serves JavaScript from disk, frontend changes must tolerate one-version-old markup until the server can be safely restarted.
- For cross-machine dashboards, verify the full chain (viewer → dashboard → upstream producer) and the freshness semantics; an HTTP 200 from a stale intermediary is not proof that live data works.
- For cumulative token axes, validate continuation metadata for every restarted-step chain; `gbs × seq_len × step` is only the incremental token count, and missing `prior_tokens` silently draws a continuation from zero.
- When the user explicitly authorizes restarting a diagnosed local service, perform
  the restart and verify it directly instead of handing the restart command back
  to them.
- Answer the user's current endpoint/error question directly. Do not substitute
  an explanation of a nearby temporary port or another service simply because it
  was part of the immediately preceding investigation.
