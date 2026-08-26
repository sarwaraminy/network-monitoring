# Network Monitoring Tool (NMT)

Passive network security monitoring. It observes traffic, raises security findings from what it
sees, and enriches any address involved with reverse DNS, WHOIS and geolocation data.

There are two ways to feed it, and they suit different deployments:

| | **Packet capture** | **Flow collection** |
| --- | --- | --- |
| Needs | Npcap/libpcap driver, admin rights, and a SPAN/mirror port for anything beyond one host | A UDP port |
| Sees | Full packets, including payload | Conversation summaries, no payload |
| Scope | Whatever the interface is shown | Every conversation crossing the exporter |
| Setup | Install a driver, configure a mirror port | One line of switch/firewall config |

Flow collection ([below](#flow-collection-netflow--ipfix)) is the easier deployment by a wide
margin and covers more of the network; packet capture is what you add on top when you need to
see payload. Both feed the same detectors and the same alert table.

## What it detects

Each detector produces an **alert**: a finding with a severity, an occurrence count and
structured evidence — not one row per suspicious packet.

| Detector | Severity | What it looks for | Packets | Flows |
| --- | --- | --- | --- | --- |
| **ARP spoofing** | Critical / High | A settled IP address suddenly claimed by a different MAC, or one MAC claiming many addresses. Bindings are learned from live traffic, so no configuration is needed. Alternating MACs (a gratuitous ARP war) escalate to critical. | ✅ | ✗ layer 2 |
| **Cleartext credentials** | Critical | HTTP Basic auth, login form posts, FTP, Telnet, POP3/IMAP and SMTP AUTH crossing the network unencrypted. **Passwords are never recorded** — only the username and the secret's length. | ✅ | ✗ payload |
| **Port scan** | High | One source probing many ports on a single host. | ✅ | ✅ |
| **Host sweep** | High | One source probing the same port across many hosts. Web and DNS ports are excluded, so ordinary browsing is not flagged. | ✅ | ✅ |
| **SYN flood** | High | An implausible rate of connection attempts from one source. | ✅ | ✅ |
| **DNS tunnelling** | Medium | Query names shaped like encoded data rather than hostnames, which is how data is smuggled out over DNS. Requires two independent signals before alerting. | ✅ | ✗ payload |
| **New device** | Medium | A MAC address never seen on this network. Known devices are persisted, and there is a learning period at the start of each capture. | ✅ | ✗ needs MACs |
| **Threat intelligence** | Critical / Medium | An address or domain matching a loaded indicator feed. The only detector here that is not a threshold — see [below](#threat-intelligence). | ✅ | ✅ |

The three that run on flow data are the ones that benefit most from it, because they depend on
seeing *many* conversations rather than the contents of one — exactly what a single interface
cannot give you.

Detection is designed for precision. The test suite includes a regression guard that replays a
realistic browsing session — a workstation talking to Microsoft, Bing, Akamai and OpenDNS — and
asserts that **zero** alerts are produced.

**Stack**

| Layer    | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| Frontend | React 18 · TypeScript · Vite · MUI · Material React Table                 |
| Backend  | Node.js · Express · TypeScript · Drizzle ORM                              |
| Capture  | Npcap / libpcap, called directly via [koffi](https://koffi.dev/) FFI      |
| Flow     | NetFlow v5/v9 and IPFIX over UDP, on Node's built-in `dgram`              |
| Database | PostgreSQL                                                                |

> Previously Spring Boot (Java 17) + Pcap4J + Create React App. See
> [Migration notes](#migration-notes) for what changed.

---

## Prerequisites

- **Node.js 20 or newer** and npm
- **PostgreSQL 14 or newer**
- **Npcap** — <https://npcap.com/#download> (Windows) or `libpcap` (Linux/macOS)

No C++ toolchain is needed. The capture layer calls the pcap library through FFI, and koffi
ships prebuilt binaries, so there is nothing to compile — see
[How capture works](#how-capture-works).

Depending on how Npcap was installed, capture may require elevated privileges: run the API
**as Administrator** on Windows, or with `sudo`/`CAP_NET_RAW` on Linux. Check with
`GET /api/packets/status`, whose `captureAvailable` field reports whether the library loaded.

---

## Setup

### 1. Install dependencies

From the repository root — this is an npm workspace, so one install covers both packages:

```bash
npm install
```

### 2. Create the database

```bash
createdb netminitoring
```

### 3. Configure the API

```bash
cp api/.env.example api/.env
```

Then edit `api/.env`. Two values matter most:

```ini
DATABASE_URL=postgres://postgres:yourpassword@localhost:5432/netminitoring
JWT_SECRET=<paste a generated secret here>
```

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

The server refuses to start without `JWT_SECRET`, by design — the Java version had its signing
key hardcoded in source.

### 4. Configure the frontend (optional)

```bash
cp network-monitoring-ui/.env.example network-monitoring-ui/.env
```

Leaving `VITE_API_SERVER` empty is correct for local development: Vite proxies `/api` and
`/auth` to `http://localhost:8080`, so the browser makes same-origin requests.

### 5. Run migrations

Migrations run automatically on boot while `DB_AUTO_MIGRATE=true`. To run them by hand:

```bash
npm run migrate
```

Existing databases are handled: if a `flyway_schema_history` table is present, its applied
versions are adopted so nothing is re-applied. The SQL files are the same Flyway-style
`V<n>__<name>.sql` files as before, now in `api/src/db/migrations/`.

### 6. Create a login

The accounts seeded by `V2__Insert_initial_data.sql` (`admin@example.com`, `user@example.com`)
carry bcrypt hashes **whose plaintext nobody has** — they came from the original Java migration.
Set a password you know:

```bash
npm run user -- set-password --email admin@example.com --generate
```

Or create your own admin account:

```bash
npm run user -- create --email you@example.com --generate --role ADMIN
```

`--generate` prints a strong random password. `npm run user -- list` shows every account, and
`npm run user` on its own lists the commands. This is also how you recover from a forgotten
password — there is no email reset flow.

### 7. Start both sides

```bash
npm run dev
```

- API — <http://localhost:8080>
- UI — <http://localhost:5173>

Or individually with `npm run dev:api` / `npm run dev:ui`.

---

## Running with Docker

Brings up Postgres, the API and the UI together. nginx serves the UI and proxies the API, so
everything is on one origin.

```bash
cp .env.docker.example .env      # then fill in JWT_SECRET and POSTGRES_PASSWORD
docker compose up --build
npm run user -- list             # see the Docker note below before running this
```

Open <http://localhost:8080>.

**Live capture does not work in this configuration**, by design: the API container has its own
network namespace, so it would only ever see its own traffic. Everything else — alerts, history,
lookups, auth — works normally. To capture, either run the API on the host (`npm run dev:api`),
or on a **Linux** host use the override:

```bash
docker compose -f docker-compose.yml -f docker-compose.capture.yml up --build
```

That grants `network_mode: host` plus `NET_RAW`/`NET_ADMIN`, which is a real privilege
escalation — a container in the host network namespace with `NET_RAW` can read all traffic the
host can see. It is **Linux-only**: on Docker Desktop for Windows or macOS the engine runs in
its own VM, so host networking attaches to that VM's interfaces rather than your machine's.

**Flow collection, by contrast, works in a container on every platform** — no privileges, no
driver, no mirror port, because the switch or firewall does the observing:

```bash
docker compose -f docker-compose.yml -f docker-compose.flow.yml up --build
```

That publishes `2055/udp` and enables the collector. Point the exporter at the host's LAN
address, then check `GET /api/flow/status`. This is the realistic way to get network-wide
detection out of a containerised deployment — see [Flow collection](#flow-collection-netflow--ipfix).

Two things that catch people out:

- **`POSTGRES_PASSWORD` only applies on first run.** Postgres sets it when it initialises the
  data directory; changing it later has no effect and the API will fail to authenticate. Use
  `docker compose down -v` to start over, or change the password inside Postgres.
- **The CLI targets whichever database `api/.env` points at.** To manage users in the container,
  run it there: `docker compose exec api node api/dist/cli/manage-user.js list`.

---

## How capture works

Pcap4J has no Node equivalent, and the usual replacement — the `cap` native addon — has to be
compiled, which needs a multi-gigabyte MSVC toolchain on Windows.

Instead, [`packet/libpcap.ts`](api/src/packet/libpcap.ts) calls the pcap library that Npcap
already installed **directly over FFI**, using [koffi](https://koffi.dev/). koffi publishes
prebuilt binaries, so `npm install` needs no compiler on any platform. Packet decoding is
plain TypeScript in [`packet/decode.ts`](api/src/packet/decode.ts).

The handle is put in non-blocking mode and drained on a timer
(`CAPTURE_POLL_INTERVAL_MS`, default 10 ms), rather than Pcap4J's dedicated `handle.loop()`
thread. A 10 MB kernel buffer absorbs bursts between polls.

If the library cannot be loaded, the API returns `503` from the capture endpoints, the capture
pages show a banner, and everything else keeps working.

### The vantage-point problem

Worth being clear about, because it determines where capture is useful at all: a network
interface only sees **its own traffic plus broadcast and multicast**. On a switched network a
workstation cannot see the laptop next to it talking to the file server. So capture from a
normal machine gives you ARP/broadcast findings and that machine's own conversations — real,
but a small slice.

Seeing the rest needs a **SPAN/mirror port** or a network TAP, which means a managed switch and
a config change. That is a bigger ask than the driver install, and it is the reason flow
collection exists below.

---

## Threat intelligence

Every other detector answers *"does this traffic look unusual?"* — a threshold, a rate, a
breadth. Useful, but a judgement: reasonable networks disagree about where the line sits.

This one answers a different question: *"is this address or domain on a list of things already
known to be malicious?"* That is not a judgement. If a host opens a connection to a current C2
address, something is wrong, regardless of how the thresholds are tuned. It is the first
detector here that produces findings a security person would call high-confidence.

```bash
# api/.env
INTEL_ENABLED=true
INTEL_FEEDS=feodo=https://feodotracker.abuse.ch/downloads/ipblocklist.txt,internal=/etc/nmt/indicators.txt
```

Then check what loaded:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/intel/status
```

**No feeds ship by default.** Which intelligence to trust is your decision, and a security tool
should not start making outbound requests to a third-party list nobody chose. Check each feed's
licence before relying on it commercially.

### Local files are first-class

A URL or a filesystem path both work. That is deliberate: the networks this tool targets —
a segregated manufacturing VLAN, a defence subcontractor's CUI enclave — frequently have no
outbound internet from the monitoring host at all. Downloaded feeds are also cached to disk, so
a restart without connectivity starts from the last known-good copy rather than from nothing.

### Direction is graded, and that is the whole trick

| Observation | Severity | Why |
| --- | --- | --- |
| **Outbound** to a listed address | Critical | Something inside chose to contact it — a compromised host, or software nobody sanctioned |
| **DNS lookup** of a listed domain | Critical | The lookup is what a beacon does first, and it happens even when the connection is blocked downstream — often the only trace left |
| **Inbound** from a listed address | Medium | The internet scans everything constantly and much of any blocklist is scanners. Grading this critical would bury you on day one |

Repeats of the same pairing share a dedup key, so a beacon calling home every thirty seconds is
one alert with a rising occurrence count rather than thousands of rows.

### What it refuses to believe

A detector whose value is that a hit *means something* must not fire wrongly — it claims
certainty, and the operator has no way to argue with it. So indicators are validated on the way
in, and the test suite leans harder on what must **not** match than on what must:

- **Private and reserved addresses are refused**, whatever a feed says. Blocklists do
  occasionally contain RFC1918 or loopback entries; accepting one would alert on every host at
  once and destroy trust permanently.
- **A malformed `1.2.3.0/` is refused.** `Number('')` is 0, so a naive parse turns that into
  `/0` — an indicator matching the entire internet. This was a real bug the tests caught.
- **An invalid `999.999.999.999` is refused**, rather than falling through to being accepted as
  a domain because it happens to contain dots.
- **Partial suffixes do not match.** `notbad.example` is not a match for `bad.example`, though
  `c2.bad.example` is — listing a domain covers what it delegates.

Feeds also go stale: an address hosting C2 last month may be an innocent VPS today. The feed
name travels with every finding, and `/api/intel/status` reports when each was last loaded and
whether it came from the network, the cache, or a file — so a feed silently serving an empty
file for a month is visible rather than looking like healthy coverage.

---

## Notifications

Detection is only half of it. Nobody watches a dashboard at 2am, so findings are
delivered to a webhook, to email, or both.

```bash
# api/.env
NOTIFY_ENABLED=true
NOTIFY_WEBHOOK_URL=https://hooks.slack.com/services/...   # or Teams, Discord, anything
NOTIFY_DASHBOARD_URL=https://nmt.example.com/alerts
```

Then prove it works before you rely on it:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/notify/test
```

That endpoint exists because notification config fails silently by nature: a wrong webhook URL
or SMTP password produces no error anyone sees until the night an alert does not arrive. It
bypasses every gate below, including `NOTIFY_ENABLED`, so you can check delivery before
committing to it.

### What stops it becoming spam

The sending is the easy part. Three independent limits apply before anything leaves the
process, because volume is what gets an alert channel muted — and then the one that mattered is
missed too:

| Limit | Default | What it does |
| --- | --- | --- |
| `NOTIFY_MIN_SEVERITY` | `high` | Critical and high only. Medium and below stay on the dashboard. |
| `NOTIFY_THROTTLE_SECONDS` | 900 | The same finding will not notify again for 15 minutes, however often it recurs. |
| `NOTIFY_MAX_PER_HOUR` | 12 | Hard ceiling. If detection misbehaves — which it has done here before — the blast radius is bounded. |

On top of those, findings are batched into a **digest** (`NOTIFY_DIGEST_SECONDS`, default 60).
A port scan produces dozens of findings; this makes it one message that leads with the most
urgent and says how many it truncated.

### Sending is disclosure

`NOTIFY_INCLUDE_EVIDENCE` is a separate switch from notifications for a reason. Evidence never
contains passwords or packet payloads — the detectors guarantee that and the tests assert it,
including the base64 form. It *does* contain internal IP addresses, MAC addresses and
usernames, and pushing those to a third-party chat service moves them outside the network you
are protecting. Turn it off and the titles still say what happened.

The webhook URL is likewise treated as a secret: `GET /api/notify/status` reports the detected
format and whether it is configured, never the URL, because for Slack and Teams that URL *is*
the credential.

Notification never affects detection. A dead webhook or a wrong SMTP password cannot stop
alerts being stored or capture running — every failure path here ends in a log line.

---

## Flow collection (NetFlow / IPFIX)

Instead of capturing packets ourselves, let the switch, router or firewall do the observing and
send us summaries. Almost everything managed already supports this: Cisco, Juniper, Fortinet,
Palo Alto, Meraki, UniFi, MikroTik, pfSense and OPNsense all export NetFlow or IPFIX.

Our side is a UDP socket on Node's built-in `dgram` — **no native module, no driver, no
elevated privileges, no mirror port**, and it runs unprivileged in the existing container.

### Enabling it

```bash
# api/.env
FLOW_ENABLED=true
FLOW_PORT=2055               # 2055 is the de facto NetFlow port; 4739 is IANA's for IPFIX
FLOW_BIND_ADDRESS=0.0.0.0
FLOW_EXPORTERS=              # empty accepts any source; fill in once devices are known
```

Then point the device at it. On pfSense/OPNsense that is the softflowd or ipfix service; on
Cisco, `ip flow-export destination <collector> 2055`; on UniFi and Meraki it is a field in the
controller UI.

Check it is arriving:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/flow/status
```

The per-exporter breakdown is the point of that endpoint. The two failure modes during setup —
"configured but nothing is arriving" and "arriving, but every record is waiting on a template" —
look identical in a single total, so they are counted separately per device.

### What is supported

| Format | Version word | Notes |
| --- | --- | --- |
| NetFlow v5 | 5 | Fixed layout, no templates. IPv4 only, and carries no MAC addresses. |
| NetFlow v9 | 9 | Templated. Flow times are switch uptime, resolved against the header. |
| IPFIX | 10 | Templated, with enterprise fields, variable-length fields and reduced-size encoding. |

Templated formats are self-describing but not self-contained: a data record is opaque until the
template describing it arrives, and templates are sent on their own interval. So for the first
few minutes after start — and again after a restart — records arrive that cannot yet be decoded.
That is normal, and `/api/flow/status` reports them as `pendingTemplates` rather than errors.

sFlow is detected and rejected with a clear log line rather than being mis-parsed as NetFlow v5,
which shares its version number. It is not supported yet, though it is the natural next
addition: sFlow samples carry a truncated raw packet header, which the existing packet decoders
could parse directly.

### Why flow detection is a separate detector

`flow/detect.ts` is deliberately not an adapter that fakes a `DecodedPacket` from a flow record.
The two observations are not interchangeable, and conflating them destroys the signal:

- a **packet's** SYN flag means "this packet opens a connection";
- a **flow's** SYN flag means "a SYN appeared somewhere in this conversation" — true of every
  established connection ever made.

An adapter would silently turn a precise signal into a meaningless one. Instead the flow
detector tests whether the conversation was **ever acknowledged**: flags accumulate over a flow,
so a successful client-side conversation ends up carrying SYN *and* ACK, while a scan does not —
the target either refuses (RST back, so the outbound flow holds only SYN) or drops silently.

"SYN present, ACK absent" therefore means "this connection was never answered", which is
genuinely unusual. That is a **better** discriminator than the packet path has, and notably
better than the original engine's rule, which flagged any SYN-without-ACK packet — i.e. every
new connection, which is why 100% of the alerts in the real database were false positives.

When an exporter omits `tcpControlBits` (it is optional in IPFIX and several vendors skip it),
the detector falls back to volume: a connection that established and did anything useful carries
more than a couple of packets.

Every flow-derived finding records its provenance in the evidence — which exporter reported it,
which ingress interface, the TCP flags, and the flow's packet and byte counts. With flow data
"how do you know?" has a specific device as its answer, and that is the first thing anyone
triaging an alert will ask.

### Security of the collector

Stated plainly, because it is a property of the protocol and not something this implementation
can fix: **NetFlow has no authentication, and UDP source addresses are spoofable.** Anything
that can route to the collector can feed it fabricated flows.

Three mitigations are built in:

- `FLOW_EXPORTERS` allow-lists source addresses. Empty accepts anything, which is needed to
  discover an exporter's address on a first run, but it should be filled in afterwards.
- `FLOW_BIND_ADDRESS` should be a management interface, not `0.0.0.0`, on any network where
  that distinction matters. Reachability is the real access control here.
- The template cache and the per-exporter counters are both **bounded**, and evict rather than
  grow. Both are filled directly from remote input, and anything unbounded on remote input is a
  memory-exhaustion bug waiting to happen.

The collector is also off by default: a listening UDP port is not something a deployment should
acquire just by upgrading.

---

## Tests

```bash
npm test          # both suites: 260 tests
npm run test:api  # 221 API tests
npm run test:ui   # 39 UI tests
```

Neither suite needs a database, a browser or a running server.

### API — 221 tests

Over `api/src/packet/` and `api/src/flow/`, covering the hand-written decoders, every detector,
the NetFlow/IPFIX parsers, and the FFI binding. They use Node's built-in test runner, so there
is no framework to install. The FFI tests skip themselves when no pcap library is present.

Three groups are worth knowing about:

- **Attack simulations** build real frames — ARP poisoning, port scans, host sweeps, SYN
  floods, cleartext logins over five protocols, DNS tunnels using base32 labels — and assert
  they are caught.
- **False-positive guards** replay ordinary traffic and assert silence. This is the suite that
  matters most: the rules these detectors replaced flagged every TCP ACK and every new
  connection, so every alert in the database was a false positive. The flow detector has the
  same failure mode available to it — every TCP flow contains a SYN — so it gets its own set:
  a browser opening 200 established connections, a host contacting 60 addresses on 443, a busy
  DNS resolver, and a file server serving 50 clients must all produce **zero** findings.
- **Wire-format tests** build genuine NetFlow v5, NetFlow v9 and IPFIX datagrams byte by byte
  from the RFCs, then parse them. Fixtures shaped by the parser's own assumptions would only
  prove the two agree, which is exactly the bug class — a misread offset — that matters here.
  These cover template arrival after data, template redefinition, enterprise fields, variable
  length, reduced-size encoding, NTP-format timestamps, and truncated or over-long sets.

The credential tests also assert that no password appears anywhere in a finding, including its
base64 form.

The IPv4/TCP fixture is rebuilt byte-for-byte from a row the Java app wrote to the `logs`
table, so the expectations are Pcap4J's own output rather than this implementation's.

### UI — 39 tests

Vitest + React Testing Library + MSW in jsdom. Requests go through MSW rather than a mocked
axios, so the tests exercise the real client — interceptors, bearer header, error unwrapping —
and only the network is substituted.

- **Auth** (`src/auth/auth.test.tsx`): sign-in, bad credentials, the rate-limit message, the
  `PrivateRoute` redirect and spinner, and an assertion that the password never reaches
  `localStorage` or `sessionStorage`.
- **Alerts** (`src/pages/AlertsPage.test.tsx`): the table, occurrence counts, detector
  filtering reaching the server, acknowledging, load failures, the empty state, the IP lookup
  dialog — and that the evidence panel shows a username and a password *length* but never the
  password.
- **Capture** (`src/pages/PacketCapture.test.tsx`): the interface dropdown, start/stop, the IP
  filter, a failed start not claiming success, mid-capture page mount, and a regression test
  that `POST /start` sends no `"null"` body.
- **Chart palette** (`src/charts/palette.test.ts`): pins the properties the data-viz validator
  checked — monotone lightness per mode, the 2:1 surface-end floor, 3:1 for bar hues, and that
  each mode has its own steps rather than a flipped copy.

Two things to know if you add tests here. Anything containing `<Navigate>` must be mounted with
`renderRoutes` and a real destination route — rendered bare it navigates, re-renders and
navigates forever, which hangs the file with no output. And run Vitest **unpiped**: sending it
through `tail` buffers everything, so a hang shows nothing at all and looks like a different
problem.

---

## Development tooling

| Command             | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `npm run dev`       | API and UI together                                              |
| `npm test`          | Decoder, detector and FFI tests                                  |
| `npm run typecheck` | `tsc` over both packages                                         |
| `npm run lint`      | Biome — lint and format check                                    |
| `npm run lint:fix`  | Biome with `--write`                                             |
| `npm run ci`        | Everything CI runs: `biome ci`, typecheck, tests                 |
| `npm run user`      | User administration (see [Create a login](#6-create-a-login))    |
| `npm run migrate`   | Apply pending migrations                                         |
| `npm run build`     | Compile the API and bundle the UI                                |

**Biome** handles both linting and formatting in one tool, configured in `biome.json`. A
`pre-commit` hook (husky) runs `biome check --staged --write` and re-stages what it fixes, so
formatting never reaches a commit. `.editorconfig` and `.nvmrc` pin editor and Node behaviour.

**CI** (`.github/workflows/ci.yml`) runs lint, typecheck and tests on Node 22 and 24, builds
both packages, and builds and smoke-tests both Docker images. The test suite needs no database,
and libpcap is installed on the runner so the FFI tests execute rather than skip. Dependabot
watches npm, GitHub Actions and both Dockerfiles, grouping routine updates and holding back the
major upgrades that need a human.

---

## Operational behaviour

**Logging** is structured JSON via pino, pretty-printed in development. Every log line carries a
`component` (`server`, `capture`, `detect`, `alerts`, `pcap`, `migrate`, `http`, `db`), and every
HTTP request gets an `x-request-id` — generated, or taken from an inbound header — which is
echoed in the response and attached to each line for that request. `LOG_LEVEL` controls
verbosity; the test runner defaults to `silent`.

Authorization headers, cookies and any field named `password` or `token` are redacted by the
logger as a backstop, so a careless log call cannot leak a credential.

**Security headers** come from helmet: a restrictive CSP (this process serves JSON only),
`Referrer-Policy: no-referrer`, `nosniff`, frame denial, and HSTS once `NODE_ENV=production`.

**Rate limits** are per client IP, per minute, and disabled under tests:

| Endpoint group        | Default | Variable                          |
| --------------------- | ------- | --------------------------------- |
| `/auth/*`             | 20      | `RATE_LIMIT_AUTH_PER_MINUTE`      |
| capture start/stop/clear | 20   | `RATE_LIMIT_CAPTURE_PER_MINUTE`   |
| `ip-info`             | 30      | `RATE_LIMIT_LOOKUP_PER_MINUTE`    |
| everything else under `/api` | 600 | `RATE_LIMIT_API_PER_MINUTE`   |

The auth limiter counts **failed attempts only**, so signing in normally never consumes quota —
important when several people share one NAT address. Once the limit trips, the window must expire
before any login succeeds, including a correct one; that is deliberate, since an attacker who
eventually guesses right should not be let through.

**Probes**: `/health` reports uptime and needs nothing but the process. `/ready` runs
`SELECT 1` and returns `503` when the database is unreachable — that is what the container
healthcheck uses.

**Shutdown** on SIGTERM/SIGINT stops captures first (which flushes buffered findings to the
database), then closes the HTTP server, then the connection pool — in that order, because
closing the pool first would silently lose the findings. A 10-second deadline forces exit if
something refuses to let go.

---

## Production build

```bash
npm run build          # compiles the API to api/dist and the UI to network-monitoring-ui/build
npm start              # serves the API from api/dist
```

Serve `network-monitoring-ui/build` from any static host, and point `VITE_API_SERVER` at the
API origin at build time. Add that origin to `CORS_ORIGIN` in `api/.env`.

---

## API reference

All `/api/*` routes require an `Authorization: Bearer <token>` header.

### Auth — `/auth`

| Method | Path      | Auth  | Purpose                                            |
| ------ | --------- | ----- | -------------------------------------------------- |
| `POST` | `/login`  | —     | Returns the user plus a `token`                    |
| `POST` | `/signup` | —     | Creates an account (password bcrypt-hashed)        |
| `GET`  | `/me`     | Token | Current account; used to validate a stored token   |
| `GET`  | `/users`  | ADMIN | All accounts, without password hashes              |

### Security alerts — `/api/alerts`

| Method   | Path                    | Purpose                                                |
| -------- | ----------------------- | ------------------------------------------------------ |
| `GET`    | `/`                     | Findings, most urgent first. Filter by `severity`, `kind`, `since` (ISO or `24h`), `acknowledged` |
| `GET`    | `/summary`              | Counts by severity and detector, for the dashboard tiles |
| `GET`    | `/devices`              | MAC addresses seen on the network                       |
| `POST`   | `/:id/acknowledge`      | Mark a finding as handled                               |
| `POST`   | `/:id/unacknowledge`    | Reopen it                                               |
| `DELETE` | `/:id`                  | Delete one finding                                      |
| `DELETE` | `/`                     | Clear all findings (ADMIN)                              |
| `DELETE` | `/devices/:mac`         | Forget a device, so it is reported as new again (ADMIN) |

### Legacy packet log — `/api`

The per-packet anomaly log that `alerts` supersedes. Nothing writes to it any more; the
endpoints remain so existing history stays reachable.

| Method   | Path            | Purpose                                |
| -------- | --------------- | -------------------------------------- |
| `GET`    | `/logs`         | All historical records                 |
| `POST`   | `/logs`         | Same as `GET` (kept for compatibility) |
| `POST`   | `/log/add`      | Create a record                        |
| `PUT`    | `/log/:id`      | Update a record                        |
| `DELETE` | `/log/:id`      | Delete a record                        |

### Packet capture — `/api/packets` and `/api/ip/packets`

Both prefixes expose the same routes and keep independent capture handles and buffers.
`/api/ip/packets/start` additionally requires `ipAddress`, applied as the BPF filter
`host <ip>`.

| Method | Path        | Query                                          | Purpose                        |
| ------ | ----------- | ---------------------------------------------- | ------------------------------ |
| `POST` | `/start`    | `interfaceName`, `snaplength`, `timeout`, `ipAddress` | Begin capturing          |
| `POST` | `/stop`     | —                                              | Stop capturing                 |
| `GET`  | `/`         | —                                              | Packets currently buffered     |
| `POST` | `/clear`    | —                                              | Empty the buffer               |
| `GET`  | `/nif`      | —                                              | Available capture interfaces   |
| `GET`  | `/status`   | —                                              | Capture state and counters     |
| `GET`  | `/ip-info`  | `ipAddress`                                    | Reverse DNS + WHOIS + geo      |

### Flow collector — `/api/flow`

| Method | Path      | Purpose                                                     |
| ------ | --------- | ----------------------------------------------------------- |
| `GET`  | `/status` | Socket state, totals, per-exporter counters, detection stats |

Read-only by design. The collector's lifetime is the process's — it is infrastructure, driven by
whether exporters are configured to send to it, not something a user starts and stops like a
capture. A start/stop endpoint would invite a UI button that silently switches off security
telemetry.

### Threat intelligence — `/api/intel`

| Method | Path      | Purpose                                                        |
| ------ | --------- | -------------------------------------------------------------- |
| `GET`  | `/status` | What is loaded, per feed, and whether it came from network/cache/file |
| `POST` | `/reload` | Re-read every feed now (**ADMIN only**)                         |

### Notifications — `/api/notify`

| Method | Path      | Purpose                                                          |
| ------ | --------- | ---------------------------------------------------------------- |
| `GET`  | `/status` | Channels configured, gates in force, what has been sent this hour |
| `POST` | `/test`   | Send a test message to every channel (**ADMIN only**)             |

`/test` is admin-only because it makes the server send outbound messages to a third party on
demand. `/status` never returns the webhook URL — for Slack and Teams that URL is the credential.

`GET /health` is unauthenticated and reports uptime.

---

## Project layout

```
api/                          Node + Express + TypeScript API
  src/
    config/env.ts             Environment parsing and validation
    db/                       Drizzle schema, pool, SQL migrations + runner
    middleware/               JWT auth guard, role guard, error handling
    packet/                   Packet decoding and detection — the Pcap4J replacement
      libpcap.ts              Npcap/libpcap binding over koffi FFI (no compiler)
      decode.ts               Ethernet, loopback, LLC/SNAP, 802.1Q, IPv4/IPv6, ARP, TCP, UDP
      names.ts                EtherType / IP protocol / LLC SAP name tables
      detect/                 One file per detector, all pure and independently testable
        arp-spoof.ts          Learned IP-to-MAC bindings; MITM detection
        scan.ts               Port scan, host sweep, SYN flood
        plaintext-credentials.ts  Unencrypted logins; never records the secret
        dns-tunneling.ts      Encoded-looking query names
        new-device.ts         Unrecognised MAC addresses
        index.ts              DetectionEngine — runs them all per packet
    flow/                     NetFlow/IPFIX collection — no driver, no mirror port
      collector.ts            UDP socket, per-exporter counters, allow-list
      parse.ts                Version dispatch; tells sFlow from NetFlow v5
      netflow-v5.ts           Fixed 48-byte records, no templates
      netflow-v9.ts           NetFlow v9 + IPFIX; one walker, dialect-parameterised
      templates.ts            Bounded template cache, keyed by exporter and domain
      fields.ts               The IPFIX information elements we read
      types.ts                Normalised FlowRecord; the unanswered-connection test
      detect.ts               Scan, sweep and flood from flows
    networkservices/          Reverse DNS, WHOIS, ip-api.com geolocation
    routes/                   Express routers
    services/
      alert.service.ts        Aggregates findings into deduplicated alerts
      device.service.ts       Persists known MAC addresses
      packet-capture.service.ts  Capture lifecycle and the poll loop
network-monitoring-ui/        React + TypeScript + Vite frontend
  src/
    api/                      Axios client and typed endpoint wrappers
    components/               AppLayout, AlertSummaryTiles, SeverityChip, CaptureToolbar,
                              PacketTable, IpInfoDialog, HexDump
    hooks/                    usePacketCapture, useIpInfo
    pages/                    AlertsPage, PacketCapture, PacketCaptureWithIP
    theme.ts                  Shared MUI theme
```

---

## Environment variables

### `api/.env`

| Variable               | Default                                        | Notes                                          |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `PORT`                 | `8080`                                         |                                                |
| `NODE_ENV`             | `development`                                  | `production` hides error details, enables HSTS and JSON logs |
| `CORS_ORIGIN`          | `http://localhost:5173,http://localhost:3000`  | Comma-separated                                |
| `LOG_LEVEL`            | `info` (`silent` in tests)                     | trace / debug / info / warn / error / fatal    |
| `DATABASE_URL`         | built from `PG*` variables                     |                                                |
| `DB_AUTO_MIGRATE`      | `true`                                         | Run pending migrations on boot                 |
| `JWT_SECRET`           | *required*                                     | Server will not start without it               |
| `JWT_EXPIRES_IN`       | `1d`                                           |                                                |
| `CAPTURE_BUFFER_SIZE`  | `5000`                                         | Packets held in memory per capture             |
| `CAPTURE_POLL_INTERVAL_MS` | `10`                                       | How often a running capture is drained         |
| `REDACT_PACKET_PAYLOAD` | `false`                                       | Blanks packet payloads in API responses — see below |
| `ARP_TRUSTED_MAPPINGS` | —                                              | `ip=mac,ip=mac` pairs treated as authoritative  |
| `FLOW_ENABLED`         | `false`                                        | Receive NetFlow/IPFIX. Off by default — it opens a UDP port |
| `FLOW_PORT`            | `2055`                                         | 4739 is IANA's for IPFIX                       |
| `FLOW_BIND_ADDRESS`    | `0.0.0.0`                                      | Narrow to a management interface in production  |
| `FLOW_EXPORTERS`       | — (any source)                                 | Comma-separated allow-list of exporter addresses |

Detection thresholds, shared by the packet and flow detectors and all tunable per network:

| Variable                     | Default  | Notes                                                    |
| ---------------------------- | -------- | -------------------------------------------------------- |
| `DETECT_SCAN_WINDOW_MS`      | `60000`  | Window for scan and sweep breadth counting                |
| `DETECT_PORT_SCAN_PORTS`     | `15`     | Distinct ports on one host before it is a port scan       |
| `DETECT_HOST_SWEEP_HOSTS`    | `20`     | Distinct hosts on one port before it is a sweep           |
| `DETECT_FLOOD_WINDOW_MS`     | `10000`  | Window for connection-rate counting                       |
| `DETECT_SYN_FLOOD_ATTEMPTS`  | `300`    | Attempts in that window before it is a flood              |
| `DETECT_DNS_SUBDOMAINS`      | `40`     | Distinct subdomains suggesting a DNS tunnel               |
| `DETECT_DEVICE_LEARNING_MS`  | `60000`  | Grace period where devices are learned silently           |
| `DETECT_ALERT_WINDOW_MS`     | `300000` | Repeats of a finding merge into one alert for this long   |

Rate limits are listed under [Operational behaviour](#operational-behaviour). For Docker, the
container-level variables live in `.env.docker.example`.

### Privacy and payload capture

Captured payloads can contain message content and personal data, which brings wiretap statutes
and GDPR into scope for whoever runs this. Two things follow:

- **Alerts never contain payloads or secrets.** Evidence is structured metadata. The credential
  detector records the username and the password's *length*, never the password.
- **`REDACT_PACKET_PAYLOAD=true`** additionally blanks the hex streams in the live packet view,
  for deployments that must not expose traffic content at all. Detection is unaffected — the
  detectors read the decoded packet, not the API response.

### `network-monitoring-ui/.env`

| Variable                | Default | Notes                                            |
| ----------------------- | ------- | ------------------------------------------------ |
| `VITE_API_SERVER`       | empty   | Empty uses the Vite dev proxy                    |
| `VITE_POLL_INTERVAL_MS` | `1000`  | Packet list refresh interval during a capture     |

---

## Migration notes

Ported from Spring Boot (Java 17) + Pcap4J + Create React App. These are the deliberate
differences.

### Detection was rewritten

The original rules asked one question per packet: "is this packet anomalous?" A port scan is
not a property of a packet, so the rules could only test surface attributes, and what they
tested fired constantly on healthy traffic:

| Old rule | Why it produced nothing but noise |
| --- | --- |
| Frame smaller than 64 bytes | Every bare TCP ACK |
| SYN without ACK | Every new outbound connection |
| Frame larger than 1500 bytes | Any segmentation-offloaded frame |
| Uncommon IP protocol | Rare, but never actionable on its own |
| ARP spoofing | Logic inverted, so it never fired correctly (below) |

Measured against the real database this produced, **every stored alert was a false positive** —
75% bare ACKs, 25% new connections, and the destinations were Microsoft, Bing, Akamai and
OpenDNS. Nothing detected was a threat, and the ARP spoofing feature the project led with had
never fired once.

Detectors are now stateful and windowed, each emitting findings with a severity and structured
evidence. Repeats aggregate into one alert with an occurrence count instead of one row per
packet. See [What it detects](#what-it-detects).

### Security

- **The JWT no longer carries the password.** The old token included the user's plaintext
  password as a `pass` claim, readable by anyone holding the token.
- **The signing key comes from `JWT_SECRET`.** It was a string literal in two Java files.
- **Tokens are actually verified.** Previously the server decoded the token to read an email
  and looked that user up; signature and expiry were never checked on protected routes.
- **The frontend no longer stores your password.** `UserContext` used to AES-encrypt
  `{userid, pass}` into `sessionStorage`, and `PrivateRoute` decided you were logged in by
  decrypting a localStorage string and comparing it to `Love<email>...<password>...`.
  Authentication is now "the server accepted our token".
- **`POST /auth/signup` no longer hands out administrator accounts to anonymous callers.**
  This was the most serious hole found in the port. The endpoint required no authentication
  *and* honoured a `role` of `ADMIN` taken straight from the request body, so a single
  unauthenticated request gave an attacker full control of a security monitoring tool —
  verified against a running server, which returned `201` with `"role":"ADMIN"`. The UI made it
  worse by advertising the path: `/sign-up` sat outside the auth guard and offered a Role
  dropdown containing Administrator.

  Account creation now permits exactly two callers: an authenticated **ADMIN**, whose role is
  read from the verified token and never from the body; and a single unauthenticated request on
  an installation with an **empty users table**, because a fresh deployment has nobody who
  could authorise the first account. That account is forced to ADMIN, and the window shuts the
  moment it exists. `ALLOW_OPEN_SIGNUP` (default off) re-enables public registration for anyone
  who wants it, and even then a self-registered account is always a USER.

  The decision lives in one pure function, `services/signup-policy.ts`, pinned by a regression
  suite that asserts a non-admin can never obtain ADMIN across every combination of inputs.
  Adding a user is now an action in the account menu, where an administrator will be, rather
  than a "register here" link on the login screen.
- **`GET /auth/users` requires an ADMIN token** and no longer returns bcrypt hashes. It was
  open to anonymous callers and serialised the whole entity.
- **Capture endpoints require a token.** They were unauthenticated, which let any caller start
  promiscuous capture on the host.
- **The IP filter is validated** before being interpolated into a BPF expression.

### Bugs fixed

- **ARP spoof detection was inverted.** `isTrustedMapping` returned true when the MAC
  *mismatched*, and `isArpSpoofed` then negated it — so every ARP packet from an unlisted
  address was reported as spoofing while genuine mismatches were ignored. The trusted pairs
  also moved from two hardcoded `10.0.0.x` entries to `ARP_TRUSTED_MAPPINGS`.
- **A failed capture start reported success.** `PcapNativeException` was caught and printed,
  and the endpoint still returned `200`, leaving the UI showing "capturing" with nothing ever
  arriving. Failures now return `500`/`503` with the reason.
- **The IP-filtered capture could throw on every ARP frame.** It saved anomaly logs without
  checking for an IP layer, against `NOT NULL` `sourceip`/`destinationip` columns. Both
  services now apply the same guard.
- **Ethernet padding was computed from fixed offsets** (14 + 20 + 20) regardless of the actual
  headers, so the column was usually empty or wrong. Padding is now the bytes past the length
  the network layer declares.
- **`PUT /api/log/:id` trusted the body's id**, so a mismatched body could overwrite a
  different row. The path id wins.
- **Loopback capture silently produced nothing.** Npcap's loopback adapter reports link type
  `NULL`, not Ethernet, and anything non-Ethernet was skipped. `NULL`, `LOOP` and `RAW` frames
  are now decoded, which also makes the app testable without touching a real network.
- **`POST /start` from the UI returned 400.** Axios serialises a `null` body to the literal
  string `null`, which `express.json()` rejects in strict mode. Only reproducible through the
  browser — `curl` sends no body at all.

### Performance

- **Packets are decoded once**, at capture time, into the DTO the UI consumes. The Java
  version kept raw `Packet` objects and re-derived every DTO on each `GET` — once per second
  per open page.
- **The packet buffer is bounded** (`CAPTURE_BUFFER_SIZE`, default 5000). The old
  `ArrayList<Packet>` grew until the process ran out of memory.
- **`ip-info` runs its three lookups in parallel** rather than in sequence, and each has a
  timeout. `getCanonicalHostName()` and the WHOIS socket could previously block indefinitely.
- **Alert writes are batched and deduplicated.** Findings buffer in memory and flush on a
  timer, so a burst of traffic costs a handful of statements rather than one insert per packet.
  A port scan that previously wrote thousands of rows now writes one, with a count.
- **Detector state is bounded** — every sliding window and lookup table has a ceiling, so
  hostile or very busy traffic cannot grow memory without limit.

### UI

- Bootstrap 5 (vendored into `public/css`) is replaced by **MUI**; both tables are
  **Material React Table**, with column filtering, sorting, resizing, density control,
  pagination and global search.
- The IP-information modal existed three times as copy-pasted markup and is now one
  `IpInfoDialog`. The two capture pages were the same 200 lines twice and now share
  `usePacketCapture` and `CaptureToolbar`.
- Hex streams moved out of table cells into an expandable **offset / hex / ASCII dump**. At a
  65 KB snapshot length a single cell previously held a ~196 000 character string.
- The capture pages read `/status` on mount, so reloading during a capture shows the real
  state instead of resetting to idle.
- Errors surface as alerts in the UI; the old code logged them to the console only.
- The landing page is now **Security alerts**: severity tiles that double as filters, findings
  ordered by urgency, and an expandable panel explaining what each one means alongside its
  evidence. Findings can be acknowledged and reopened.

### Removed

- `crypto-js` — the client-side encryption it powered is gone, and it was never a security
  boundary since the key shipped in the bundle.
- `HexConverter`, `PacketParser` — unused dead code in the Java tree.
- CRA's `reportWebVitals` / `setupTests` / `App.test.js` boilerplate, and the Java project's
  only test — Spring's generated `contextLoads()`. Replaced by real decoder tests, below.

### Behaviour differences

Both `/start` parameters mean what they did before: `snaplength` becomes `pcap_set_snaplen` and
`timeout` becomes `pcap_set_timeout`, the same calls Pcap4J's `openLive(snaplen, mode, timeout)`
made underneath.

IPv6 addresses render in RFC 5952 compressed form (`2001:db8::1`) rather than Java's fully
expanded `2001:db8:0:0:0:0:0:1`.

Named numbers keep Pcap4J's exact `0x0800 (IPv4)` spacing, because rows written by the old app
share the `logs.ipversion` column with new ones. `decode.test.ts` pins this.

Packet timestamps now come from pcap itself rather than `LocalDateTime.now()` at the moment the
handler ran, so they reflect when the frame actually arrived.

---

## Screenshots

> These predate the MUI rewrite and the alerts page — the flows are the same, the interface is
> not. Worth recapturing before showing the project to anyone.

**Login**

![Login page](./screenshots/login.png)

**Findings list** (previously the anomaly log)

![Logs](./screenshots/Logs.png)

**Capture from an interface**

![Scan packets](./screenshots/scanPacket.png)

**Capture filtered by IP**

![Scan packets by IP](./screenshots/scanPacketIP.png)

**WHOIS lookup**

![WHOIS lookup](./screenshots/whoisLookup.png)

---

## Troubleshooting

**`Missing required environment variable JWT_SECRET`** — copy `api/.env.example` to
`api/.env` and generate a secret.

**`Invalid email or password` with the seeded accounts** — the plaintext for
`admin@example.com` and `user@example.com` was never recorded; the hashes came from the original
Java migration. Set one with `npm run user -- set-password --email admin@example.com --generate`.

**`Too many failed attempts`** — the auth rate limit tripped after 20 failed logins in a minute
from your IP. Wait for the window to expire, or raise `RATE_LIMIT_AUTH_PER_MINUTE`. Successful
logins do not count toward it.

**`password authentication failed for user "postgres"` under Docker** — `POSTGRES_PASSWORD` only
takes effect when the data directory is first created. If you changed it after the first run,
either revert it or start fresh with `docker compose down -v`.

**No interfaces in the dropdown / `503` from `/nif`** — the pcap library could not be loaded.
Install Npcap (Windows) or libpcap (Linux/macOS) and restart the API. `captureLibrary` on
`GET /api/packets/status` shows which library was found. See
[How capture works](#how-capture-works).

**`Could not open <interface>` / permission denied** — start the API as Administrator
(Windows) or with `sudo` (Linux).

**`Cannot reach the API server`** — the API is not running on port 8080, or `CORS_ORIGIN` does
not include the UI's origin.

**Capture starts but no packets appear** — check `linkType` on `/api/packets/status`.
`ETHERNET`, `NULL`, `LOOP` and `RAW` are decoded; other link layers (802.11 radiotap, for
instance) are not.

**Capture runs but no alerts appear** — that is the expected result on a healthy network.
Alerts mean something specific happened, and ordinary traffic produces none by design. To
confirm the pipeline works, capture on the loopback adapter and make a request carrying an
`Authorization: Basic` header to a local plain-HTTP service; that should raise a critical
finding within a few seconds.

**Too many or too few alerts** — every threshold is tunable; see the detection variables above.
`DETECT_PORT_SCAN_PORTS` and `DETECT_HOST_SWEEP_HOSTS` are the two worth adjusting first.

---

## Roadmap

**Detection**

- Track SYN responses, so a scan against closed ports is separated from one that found a
  service. This is the single biggest precision win still available.
- TLS inspection: certificate and JA3/JA4 fingerprinting, plus expired and self-signed
  certificates on internal services.
- Beaconing detection — regular, evenly spaced connections to one destination, the signature of
  command-and-control.
- Detect ARP bindings that contradict DHCP, when DHCP traffic is visible.
- Flow-native detectors that packet capture cannot do as well: beaconing, data-exfiltration
  volume, and new-peer detection across the whole segment.

**Driver-free telemetry** — extending what the flow collector started, so more detectors work
without a capture driver or a mirror port:

- sFlow. Its samples carry a truncated raw packet header, so the existing packet decoders could
  parse them directly.
- SNMP polling of the router's ARP table (`ipNetToMediaPhysAddress`), which would restore
  **ARP spoofing** detection — the headline feature — with no capture at all.
- SNMP polling of the switch MAC-forwarding table, or DHCP lease logs, restoring **new device**
  detection.
- DNS server query logs (Windows DNS, Pi-hole, AdGuard, pfSense), restoring **DNS tunnelling**.
- Syslog ingestion from firewalls, which most SMB deployments already have configured.

That would leave cleartext-credential detection as the only feature genuinely requiring packet
capture, since nothing else sees payload.

**Product**

- Stream over WebSocket/SSE instead of polling once a second.
- Retention and rollup, so the alerts table stays bounded over months.
- pcap export, so a finding can be opened in Wireshark for deeper analysis.
- Docker Compose, so the whole stack starts with one command.
- Traffic visualisation over time: top talkers, protocol mix, alerts per hour.

**Deployment**

- Document the SPAN port / network TAP setup. Running on a workstation only sees that
  workstation's own traffic plus broadcasts, which is the most common reason the tool appears
  to find nothing.

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm run build`
before opening one.

## License

MIT — see `LICENSE`.
