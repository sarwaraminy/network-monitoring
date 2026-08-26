# Fix privilege escalation in signup; add notifications, validation tests and zod 4

## Security: unauthenticated administrator creation

`POST /auth/signup` required **no authentication** and honoured a `role` of `ADMIN` taken
straight from the request body. One anonymous request granted full control of a security
monitoring tool. Verified against a running server before the change:

```
$ curl -i -X POST http://localhost:8080/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"email":"attacker@evil.test","password":"...","firstname":"Mallory","role":"ADMIN"}'

HTTP/1.1 201 Created
{"id":5,"email":"attacker@evil.test","role":"ADMIN", ...}
```

The UI advertised the path: `/sign-up` sat outside the auth guard and offered a Role dropdown
containing Administrator, so loading the page was enough.

**Account creation now permits exactly two callers:**

1. An authenticated **ADMIN**, whose role is read from the verified token and never from the body.
2. A single unauthenticated request on an installation with an **empty users table** — a fresh
   deployment has nobody who could authorise the first account. That account is forced to ADMIN
   and the window shuts the moment it exists, so it cannot be used to add a second.

A presented-but-invalid token is rejected outright rather than falling through to the
unauthenticated paths. `ALLOW_OPEN_SIGNUP` (default off) restores public registration for a
deployment that wants it, and even then a self-registered account is always a USER.

The decision lives in one pure function, `services/signup-policy.ts`, so it can be pinned
without a database or an HTTP server. Its suite asserts across **every** combination of
requested role, open-signup setting and token state that a non-admin can never obtain ADMIN.

Post-fix, verified live: anonymous+ADMIN → 401, anonymous+USER → 401, garbage token → 401,
non-admin token → 403, admin creates USER → 201, admin creates ADMIN → 201.

Adding a user moved to the account menu, where an administrator will be, replacing the
"register here" link on the login screen. Every other route was audited: all routers apply
`requireAuth` globally and destructive actions already require ADMIN.

## Notifications

Detection previously ended at a database row nobody was told about. Findings now reach a
webhook (Slack, Teams, Discord, or any endpoint taking JSON) and email over SMTP.

Sending is the easy part; volume is what gets an alert channel muted, so four limits apply
before anything leaves the process:

| Limit | Default | Effect |
| --- | --- | --- |
| `NOTIFY_MIN_SEVERITY` | `high` | Critical and high only |
| `NOTIFY_DIGEST_SECONDS` | 60 | A scan's burst becomes one message |
| `NOTIFY_THROTTLE_SECONDS` | 900 | Same finding will not re-notify |
| `NOTIFY_MAX_PER_HOUR` | 12 | Hard ceiling |

`NOTIFY_INCLUDE_EVIDENCE` is a separate switch from enabling notifications. Evidence never
contains passwords or payloads, but it does contain internal addresses and usernames, and
sending those to a third-party chat service moves them outside the network being protected.
`GET /api/notify/status` likewise never returns the webhook URL, which is itself a credential
for Slack and Teams.

Notification cannot affect detection: `AlertSink` swallows the notifier call, channels return
results rather than throwing, and delivery uses `allSettled`. `POST /api/notify/test`
(ADMIN-only) exists because this configuration fails silently by nature.

A test asserts a password never appears in any of the six message formats, including its
base64 form.

## Validation layer tested, then zod 4

Request validation is the boundary where untrusted input becomes trusted data, and it had **no
tests at all** — a schema that quietly stopped rejecting something would not have failed the
build. That is also what made the pending zod 4 bump unmergeable: v4 changes `z.coerce`
semantics, `.default()` inference and the `.email()` API, and CI would have passed either way.

Schemas moved out of four route files into `routes/validation.ts`, which imports no service and
no database. 39 tests cover what each must refuse: `limit` above 500, negative `offset`, an
unknown severity or detector kind, a `bucket` outside the closed set that `sql.raw` inlines into
`date_trunc`, an id that is zero/negative/fractional, a `since` that would become an Invalid
Date and silently match no rows, an unbounded `ipAddress` heading for a BPF expression.

Writing them found a real one: `z.coerce.number().int().positive()` accepts `true`, because
`Number(true)` is 1. Express only hands these strings so it could not bite today, but a schema
called `idSchema` should not accept a boolean — nor `null`, `[]` or `{}`, all of which
`Number()` turns into 0. The input type is now restricted before coercion.

With that in place the zod 4 upgrade needed exactly two edits and both suites stayed green.

## Dependency advisories

`npm audit fix` cleared brace-expansion, nanoid and the react-router CSRF advisory without a
breaking change — lockfile only, no version ranges moved. **9 vulnerabilities → 5, high 5 → 1.**

The remaining high is **drizzle-orm** (SQL injection via improperly escaped identifiers), fixable
only by a semver major. Reviewed against this codebase and **not exploitable as written**: there
is no `sql.identifier()` call anywhere, every `pgTable()` name is a string literal, and the one
`sql.raw()` inlines a ternary over two hardcoded strings, so no user input can reach an
identifier position. Wants upgrading deliberately, not urgently. The four remaining moderates
are drizzle-kit's esbuild chain — a devDependency, so none of it ships.

Dependabot was also producing 13 open PRs: npm was capped at 5 but the limit was left unset on
github-actions and both docker directories, where it defaults to 5 each. Every ecosystem now has
an explicit limit and a group.

> One correction worth flagging: an earlier commit on this branch added `drizzle-orm` to the
> Dependabot `ignore` list. That was wrong — an `ignore` entry suppresses the *security* update
> too, so it would have hidden the PR fixing an open advisory. Removed, with the rule written
> down: never ignore a package carrying an open advisory.

## UI

- App bar is translucent and scheme-aware instead of pinned to `#0f172a` in both themes
- Page and card surfaces were ~1.07:1 apart in light mode; page colour deepened, outlined
  surfaces given a shallow lift. `background.paper` untouched, because `charts/palette.ts` is
  validated against those exact surfaces
- Material React Table now matches the Card surface rather than floating on its own elevation
- Theme switch moved into the account menu as an inline segmented control
- Column resizing off on the packet table — ten fixed-width columns with bounded contents

## Testing

| | Before | After |
| --- | --- | --- |
| API | 102 | **188** |
| UI | 34 | **39** |

typecheck, `biome ci` (123 files) and build all clean. An independent security review of this
branch found no reportable vulnerabilities.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
