# External subscription quota adapter

Use this when your custom endpoint is backed by a subscription and you have a reader that can report its real weekly quota. LCW does not include a provider-specific adapter, identify your billing plan from the endpoint, or install one during the optional setup conversation. Keep dollar tracking or dismiss the offer if this does not apply.

After installing a release with `quota-command` (or running `claude plugin update lcw` and restarting), make your reader available on `PATH`, then configure its exact `ANTHROPIC_BASE_URL` endpoint:

```sh
lcw quota-command 'https://proxy.example/v1' 'quota-reader'
lcw quota-command
lcw quota-command off
```

The first command requires a successful reading; the second inspects the setting, and `off` disables it without changing the separate spend command. A failed replacement keeps the previous setting. Equivalent URLs normalize to the same endpoint, but another path or host does not match; selectors containing credentials, queries or fragments are rejected. Native sessions and other endpoints keep their own billing selection.

The reader must exit successfully within 30 seconds and print one JSON object to stdout. A successful reading has this shape; values are illustrative, not a reset date to reuse:

```json
{"v":1,"status":"ok","accountKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","weekly":{"percentUsed":42,"resetsAt":"2026-12-01T12:00:00.000Z"},"blocked":false}
```

`accountKey` is a stable, non-secret 64-character lowercase hex digest (optionally prefixed `sha256:`), never a raw identifier. `percentUsed` is finite and between 0 and 100; `resetsAt` must be the provider's actual future weekly reset in ISO date-time format, not an invented rolling date. `blocked` is a boolean. When no trustworthy weekly window exists, print `{"v":1,"status":"unavailable","code":"no-weekly-window"}`; for provider refusal, print `{"v":1,"status":"refused","code":"provider-refused"}`. Other accepted failure codes are `auth`, `network`, `timeout`, `invalid-response`, `ambiguous-weekly-window`, `account-changed`, and `command-failed`. Failure results may carry the same non-secret `accountKey`, but cannot configure the source.

LCW refreshes about every five minutes. A failed, refused, blocked or stale reading, or a percentage at your mark, holds new work; an earlier good reading is history, not permission. A reset needs a fresh allowable reading to resume work, and does not clear a human pause. Percentages are **account-wide**, not attributable to this machine or repository, and provide no dollar estimate.

Keep credentials in your reader's protected configuration, not in the saved command text, arguments or environment assignments. The reader runs only in a POSIX environment; native Windows fails closed as `command-failed`, while WSL provides a Linux environment.
