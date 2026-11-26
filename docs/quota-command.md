# Billing and external quota

LCW tracks a Claude subscription by the week's usage, and API billing by estimated dollars. If your `ANTHROPIC_BASE_URL` points at a proxy backed by a subscription, and you have a program that reads its real weekly quota, LCW can track that instead. LCW ships no such reader and cannot tell your plan from the endpoint; without one, keep dollar tracking.

## Set it up

Put your reader on `PATH`, then ask Claude to run these (`lcw` is Claude's command, not one on your `PATH`):

```sh
lcw quota-command 'https://proxy.example/v1' 'quota-reader'   # set it for this endpoint
lcw quota-command                                             # show the setting
lcw quota-command off                                         # turn it off
```

Setting it needs one good reading; if that fails, the old setting stays. Only that endpoint matches (the same URL written another way, with a trailing slash, capital letters in the host or the default port, still does; another host or path does not), and an endpoint with credentials, a query or a fragment is refused. Keep credentials in the reader's own configuration, never in the command.

## What the reader prints

Within 30 seconds, exit successfully and print one JSON object (values here are an example):

```json
{"v":1,"status":"ok","accountKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","weekly":{"percentUsed":42,"resetsAt":"2026-12-01T12:00:00.000Z"},"blocked":false}
```

- `accountKey`: a stable 64-character lowercase hex digest, optionally prefixed `sha256:`, never a raw identifier.
- `percentUsed`: 0 to 100. `resetsAt`: the provider's real next weekly reset, never an invented one: a date-time like `2026-12-01T12:00:00Z` or `2026-12-01T13:00:00+01:00` (seconds required, optional fraction, then `Z` or an offset with a colon), in the future.
- `blocked`: required, `true` or `false`.
- On failure, print `{"v":1,"status":"unavailable","code":"no-weekly-window"}`, or `"status":"refused","code":"provider-refused"`. Other codes: `auth`, `network`, `timeout`, `invalid-response`, `ambiguous-weekly-window`, `account-changed`, `command-failed`.

## How LCW uses it

It reads about every five minutes. A failed, refused, blocked or stale reading holds new work, as does reaching your mark; after a reset, work resumes only on a fresh good reading, and never undoes a pause you asked for. The percentage is the whole account's, not this machine's, and gives no dollar figure. The reader needs a POSIX system: on native Windows it always fails; WSL works.
