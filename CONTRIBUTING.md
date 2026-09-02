# Contributing

This is the "where do I start" doc. It is a guided path through the codebase, not a
reference — for setup steps, environment variables, the full file layout and test counts, see
the [README](README.md), which this doc links into rather than repeats.

## 1. Get it running

Follow the README's [Setup](README.md#setup) section (`npm install`, `npm run dev`). Do this
before reading anything else — most of what follows is easier to place once you've seen the UI
at <http://localhost:5173> and clicked around, and confirmed the API answers at
<http://localhost:8080/health>.

You don't need Npcap/libpcap or a live network interface to develop most of this project. Packet
capture needs it; everything else — the API, the UI, alerts, suppression rules, notifications,
flow collection — works against the test fixtures and a database with no capture running at all.

## 2. Read these five files first

In this order, they explain the shape of the whole system faster than the file tree does:

1. **[`api/src/packet/detect/types.ts`](api/src/packet/detect/types.ts)** — the `Finding` type and
   the detection framework's own explanation of *why* it's stateful and windowed rather than
   per-packet. This is the vocabulary ("finding", "severity", "dedupKey") the rest of the backend
   is built on.
2. **[`api/src/packet/detect/index.ts`](api/src/packet/detect/index.ts)** — `DetectionEngine`,
   the thing that turns a decoded packet into zero or more findings by running every detector
   over it. Short enough to read end to end in a few minutes.
3. **[`api/src/services/alert.service.ts`](api/src/services/alert.service.ts)** — where findings
   become alerts: deduplication within a time window, suppression, notification, and the
   dashboard trend logic. This is the layer both pipelines below converge on, regardless of
   which one produced the finding.
4. **[`api/src/routes/alerts.routes.ts`](api/src/routes/alerts.routes.ts)** — a short, typical
   router: `requireAuth` mounted once for the whole router, `requireRole('ADMIN')` added to the
   individual routes that need it, a zod schema from `validation.ts` parsing the request, a
   service function doing the work, `asyncHandler` turning a thrown `HttpError` into the right
   status code.
5. **[`README.md`](README.md#project-layout)**'s "Project layout" section — now that you've seen
   real code, the file tree it describes will actually mean something.

## 3. The mental model

Two independent pipelines feed the same alert table:

```
Packet capture (libpcap/Npcap, live traffic)   ─→ DetectionEngine     ─┐
                                                    (packet/detect/)    ├─→ Finding[] → AlertSink
Flow collection (NetFlow/IPFIX, UDP, no driver)─→ FlowDetectionEngine ─┘   (services/alert.service.ts)
                                                    (flow/detect.ts)                 │
                                                                    dedup, suppression, notify
                                                                                      │
                                                                                      ▼
                                                                             alerts table (Postgres)
```

The alerts table currently grows without bound — see the README's [Roadmap](
README.md#roadmap) for the retention/rollup work planned to change that.

Two separate engines, deliberately — see the README's "[Why flow detection is a separate
detector](README.md#why-flow-detection-is-a-separate-detector)" — not one shared class. A
**detector** (registered in either engine) never touches the database — it's pure, stateful only
in memory, and independently unit-testable with hand-built packets or flow records. Everything
downstream of "producing a `Finding`" — dedup, suppression, storage, notification — lives in
`alert.service.ts` and is the same regardless of which engine produced the finding. If you're
adding new detection logic, this is the boundary to respect: detectors decide *what happened*,
`alert.service.ts` decides *what to do about it*.

On the frontend, `network-monitoring-ui/src/api/` wraps every backend endpoint in a typed
function; pages call those, never `axios` directly. `AppLayout` and the shared MUI `theme.ts`
are the two files that touch every page's shell.

## 4. Common tasks, and where they start

**Add a new detector.** Copy the shape of the smallest existing one
(`api/src/packet/detect/new-device.ts` is a good template) or, for flow-based detection,
`api/src/flow/detect.ts`. Implement `Detector` from `types.ts`, register it in
`DetectionEngine`'s constructor (`packet/detect/index.ts`), add its `AlertKind` to the
`ALERT_KINDS` list in `types.ts`. Then write both kinds of test the existing detectors have: an
**attack simulation** that builds a real packet/flow and asserts it's caught, and a
**false-positive guard** that replays ordinary traffic and asserts silence — see [Tests](
README.md#tests) for why the guard matters as much as the detection.

**Add an API endpoint.** Add the route in `api/src/routes/`, following
`alerts.routes.ts`'s pattern: `requireAuth` (mounted on the router already, in most cases), a
schema in `validation.ts` parsing `req.query`/`req.body`, the actual work in a `services/*.ts`
function. Not every mutating route needs more than `requireAuth` — in `alerts.routes.ts` itself,
acknowledging an alert is open to any signed-in user, while `requireRole('ADMIN')` is reserved
for the routes whose damage is hard to undo (clearing the whole alert table, forgetting a
device). Decide which your route is before copying a guard. Add a case to `route-guards.test.ts`
either way — that suite is what catches a guard installed on the wrong path, or missing entirely
from one that needed it.

**Add a migration.** SQL files in `api/src/db/migrations/`, named `V<n>__<description>.sql`,
picked up automatically by `npm run migrate` / on boot while `DB_AUTO_MIGRATE=true`. Update the
Drizzle schema in `api/src/db/schema.ts` to match — the migration is the source of truth for the
database, the schema file is what the query builder and TypeScript see, and they have to agree
by hand; nothing generates one from the other here.

**Add or change an environment variable.** `api/src/config/env.ts` is where nearly all of
`process.env` is read and parsed — everything else should import the parsed `env` object rather
than read `process.env` directly. Two deliberate exceptions: `logger.ts` reads `NODE_ENV`/
`LOG_LEVEL` itself, because it has to exist before `env.ts` can load; and
`notify/settings.service.ts` reads the environment directly as the non-crashing fallback layer
beneath the stored delivery settings. Add a new variable to `env.ts` with the
`required`/`optional`/`int`/`bool` helpers already in the file, document it in the README's
[Environment variables](README.md#environment-variables) table, and add it to
`api/.env.example`. There's a test (`env-defaults.test.ts`) that holds `.env.example` and the
Docker Compose files to `env.ts`'s own defaults in *text* — see [Tests](README.md#tests) for why
that file exists and how a widened regex can silently stop covering a variable.

**Add a suppression-affecting change.** Rule matching lives in
`api/src/services/suppression-rules.ts` — pure, no database, and worth testing thoroughly for a
reason: a rule that hides more than its author intended is a security bug wearing a convenience
feature's clothes. Read the "Suppression rules" section of the README before changing it.

**Add a UI page or component.** Look at an existing page in `network-monitoring-ui/src/pages/`
for the shape (data fetching via `api/`, MUI components, a loading/error/empty state). Tests use
Vitest + React Testing Library + MSW — real requests through a mocked network, not a mocked
client. Two traps worth knowing before you write one: anything rendering `<Navigate>` must be
mounted with `renderRoutes` (see [Tests](README.md#tests)), and Vitest must run **unpiped** or a
hang shows nothing at all.

## 5. Before opening a PR

```bash
npm run ci && npm run build
```

`npm run ci` covers what most of CI's jobs run — Biome (lint + format check), `tsc` over both
packages, and both test suites, none of which need a database. It does **not** run `npm run
build`, which is CI's separate `build` job (compiling the API and bundling the UI) — run it too,
since a change can pass `ci` and still fail to compile or bundle. `npm run lint:fix` fixes what
Biome can fix automatically; the rest it reports.

A few conventions this codebase holds to more strictly than most:

- **Comments explain *why*, not *what*.** A comment restating the line below it gets deleted in
  review. A comment recording a non-obvious constraint, a bug that a fix like this one
  reintroduces, or a trade-off deliberately made — that's what's expected, and the existing files
  are full of examples of the tone.
- **A fix ships with the test that would have caught it.** Where practical, verify that test by
  temporarily reintroducing the bug and confirming it fails, then restore the fix — a test that
  would pass either way is worse than no test.
- **Tests need no database, no browser, no running server.** If a change makes that stop being
  true, that's worth a second look before committing to it — see the README's [Tests](
  README.md#tests) section for how migrations and other SQL-heavy paths are instead verified by
  hand against a real Postgres and documented as such, rather than mocked.

## License

MIT — see [LICENSE](LICENSE).
