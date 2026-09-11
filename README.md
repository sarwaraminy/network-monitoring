# Network Monitoring Tool (NMT)

Passive network security monitoring for the networks cloud tools cannot reach — a segregated
manufacturing VLAN, a defence subcontractor's CUI enclave, any monitoring host with no outbound
internet. Local indicator files are first-class, downloaded feeds cache to disk so a restart
without connectivity starts from the last known-good copy, and every deletion is recorded in an
append-only trail the database itself refuses to modify.

Not another dashboard. Eight detectors, tuned for precision — the test suite replays an ordinary
browsing session and asserts that zero alerts are produced. Suppression rules, so the authorised
nightly scanner does not train whoever is on call to ignore the alerts table. Retention that
rolls each expiring day up rather than deleting it, so a year-old month still has a trend line
instead of a flat one that looks like a quiet network.

It observes traffic, raises findings from what it sees, and enriches any address involved with
reverse DNS, WHOIS and geolocation data. There are two ways to feed it, and they suit different
deployments:

| | **Packet capture** | **Flow collection** |
| --- | --- | --- |
| Needs | Npcap/libpcap driver, admin rights, and a SPAN/mirror port for anything beyond one host | A UDP port |
| Sees | Full packets, including payload | Conversation summaries, no payload |
| Scope | Whatever the interface is shown | Every conversation crossing the exporter |
| Setup | Install a driver, configure a mirror port | One line of switch/firewall config |

Flow collection ([below](#flow-collection-netflow--ipfix)) is the easier deployment by a wide
margin and covers more of the network; packet capture is what you add on top when you need to
see payload. Both feed the same detectors and the same alert table.

This README is written for whoever installs and changes the thing. For whoever *uses* it —
the screens, what each one is telling you, and what each role may do — there is a
**[user guide](user-guide/index.html)**. It is served by the
application itself at `/user-guide/` — behind a signed-in session, like every other screen,
which is why it lives here and not in `network-monitoring-ui/public/` where the web server
would hand it out unauthenticated. Reachable in the product from the help icon in the header.

## Watch it instead

Before any of what follows: the application being used. Signing in, a scan turning up in
the alerts table, the evidence behind it, a rule that declares the next one expected, and
where a finding goes when it leaves here.

[![A tour of the application: the dashboard, a finding and its evidence, threat intelligence, suppression rules, delivery and the audit trail](./user-guide/video/nmt-tour-poster.png)](./user-guide/video/nmt-tour.mp4)

**[Play the tour](./user-guide/video/nmt-tour.mp4)** &mdash; 4 min 18 s, narrated, and every
spoken line is captioned on screen so it works muted. GitHub plays it in the browser; in a
clone it is `user-guide/video/nmt-tour.mp4`. The [user guide](user-guide/index.html)
embeds it on its first page, which is where an operator will look for it.

Everything in it is the real application against a demo database. The findings are real
detector output rather than fixtures: `scripts/demo/traffic.mts` sends synthetic NetFlow
over UDP and the detectors judge it exactly as they judge a switch's, so the port scan on
screen crossed the same threshold a real one has to. Recorded by
[`scripts/record-demo.mjs`](scripts/record-demo.mjs) for the same reason the
[screenshots](#screenshots) are captured by a script rather than by hand &mdash; a tour of
a screen that no longer exists is the one a reader trusts over the application in front of
them:

```bash
npm i -D playwright ffmpeg-static && npx playwright install chromium   # once

# One terminal: the application, with flow collection and the demo feed on.
FLOW_ENABLED=true INTEL_ENABLED=true INTEL_FEEDS=demo=scripts/demo/indicators.txt npm run dev

# An account that exists only to be filmed, because the tour types it on camera.
npm run user -- create --email demo@example.com --password '...' --role ADMIN

# Another terminal: fill the screens, then record. FFMPEG only if none is on PATH.
npx tsx scripts/demo/traffic.mts
DEMO_EMAIL=demo@example.com DEMO_PASSWORD='...' FFMPEG=./node_modules/ffmpeg-static/ffmpeg.exe node scripts/record-demo.mjs
```

The voice is the speech engine that ships with Windows, driven offline by
`scripts/demo/narrate.ps1`. It sounds like what it is &mdash; a computer reading &mdash;
and that is the trade being made on purpose: the narration is fifteen strings in the
recording script, so correcting a line is a text edit rather than a studio booking, and a
tool built for networks with no outbound internet does not send its own script to a cloud
voice service to be read back. `DEMO_SILENT=1` records the tour without narration, and
`DEMO_RATE`, between -10 and 10, changes how fast it is read &mdash; the default sits a
little under normal speed, which is most of why the runtime is what it is.

Point it at a demo installation and sign in with a throwaway administrator. The tour types
the address into the login form on camera, and it *writes* &mdash; the suppressions beat
fills in the new-rule dialog and saves it, because a recording of a screen that says "no
rules" does not show what suppression is for.

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

- **Node.js 22 or newer** and npm — 22 rather than 20 because `node --test` only expands the
  `**` in the test scripts' glob from 22 onwards; on 20 it matches nothing and exits 0
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

**Fast path:** `npm install` generates `api/.env` and a root `.env` — each with a real
`JWT_SECRET` and a matching database password already filled in — plus an empty
`network-monitoring-ui/.env` (it has no secrets to fill). Then `npm run dev` checks whether that
database is reachable and, if Docker is installed but nothing is listening on `localhost:5432`,
starts one for you (`docker-compose.dev.yml`) — no `createdb`, no manual secret generation. If
you already run Postgres locally, just update `DATABASE_URL` in `api/.env` to match it and that
check gets out of the way. The steps below are for doing any of that by hand, or understanding
what the fast path did — **skip step 3's `cp` if `npm install` already created `api/.env`**,
copying over it would re-blank the secret and password it just generated.

### 1. Install dependencies

From the repository root — this is an npm workspace, so one install covers both packages:

```bash
npm install
```

### 2. Create the database

Not needed on the fast path above — Docker creates it, or your existing Postgres already has it:

```bash
createdb netminitoring
```

### 3. Configure the API

`npm install` already created this if it didn't exist (see the fast path above) — skip the `cp`
below in that case, it would overwrite the generated `JWT_SECRET` and `DATABASE_URL` password:

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

There are no seeded accounts. `V2__Insert_initial_data.sql` used to create
`admin@example.com` and `user@example.com`, both carrying a bcrypt hash committed to this
repository — a published hash is a published credential, so `V5__Remove_seeded_accounts.sql`
deletes any row still holding it.

That makes the first-account bootstrap reachable, which on a fresh database means:

> **The first unauthenticated request to `POST /auth/signup` becomes ADMIN**, and the window
> shuts the moment that account exists. Create it before the port is reachable by anyone else.

Do that through the sign-up page, or from the command line:

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
# npm install already created this (see the Setup fast path) — skip the cp
# below if it did, it would overwrite the generated JWT_SECRET/POSTGRES_PASSWORD.
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

### A capture does not survive a restart

Capture is held in the running process: `startCapture` opens a pcap handle and sets some
fields, and nothing about it outlives the process. Flow collection restarts itself at boot
from `FLOW_ENABLED`; capture does not, and the screen afterwards said *Idle* — the same word
it uses for a host that has never captured anything. For a monitoring product a gap in
monitoring that nothing reports is the worst state it can be in, because it looks exactly
like the good one.

`capture_session` (V18) records what each sensor was asked to run and whether it was still
running when the process last had an opinion. At boot a session left running is reported on
the Capture screen — the interface, who started it and when, with a Resume button.

**The row is stamped stopped once the interruption has been dealt with, which is not always
the run that found it.** With `CAPTURE_RESUME_ON_START` off, nothing is going to bring the
capture back, so the stamp happens immediately and the next run does not repeat a report
about an interruption already seen. With it on, the row stays open until a resume actually
succeeds — a successful one replaces it, and a failed one needs it to still be there, because
that row is the only thing that lets the next boot try again. So an interruption nothing has
acted on yet is reported again, deliberately: that recurrence is what keeps unattended
capture recoverable after a reboot that came up before its network did. Within a run the
banner stays until somebody starts a capture — the notice is that monitoring stopped, which
remains true until it is acted on.

`startedBy` is stripped for a non-admin. `GET /status` sits behind `requireAuth` rather than
an admin gate, and it is an administrator's email address; the rest of the notice is not
privileged. It is no longer the only record that anyone started a capture: `capture.start`
and `capture.stop` are audit actions now, so the answer lives in the trail — behind an
admin-only read, which is where this redaction wanted it.

`CAPTURE_RESUME_ON_START=true` makes the service start it again instead. **Off by default,
and env-only**: capture reads other people's traffic, and doing that with nobody present is
a decision about the installation rather than a click in a browser — the same argument
`ADHOC_DB_PASSWORD` makes about giving the database a SQL prompt. It only ever resumes a
capture an operator explicitly started, on the interface they named, with the filter they
set. Reporting the interruption is not optional; only the automatic part is.

The row is keyed on `(sensor_id, scope)`. One process runs two captures — interface-wide and
IP-filtered — so a row per sensor alone would have had them overwriting each other's session,
the same way two sensors would: the shape of the `known_devices` bug V16 fixed, one table
along.

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

Then open **Threat Intel** in the navigation bar to see what loaded.

### The page is a table of feeds, not a count of indicators

"1,204 indicators loaded" is the least useful thing this feature can report. A feed silently
serving an empty file, or quietly falling back to a months-old cached copy, looks identical to
a healthy one from a total — and a detector that stopped matching is worse than one never
enabled, because it looks like coverage.

So every feed shows where its contents actually came from:

| Badge | Meaning |
| --- | --- |
| **Live** | Downloaded on the last refresh. Current. |
| **Cached** | The download failed and the saved copy was used. Detection works, but these indicators are as old as the last successful fetch. |
| **Local file** | Read from disk. Freshness is whatever your own process makes it. |
| **Failed** | Nothing loaded. These indicators are not being matched at all. |

Failed and cached feeds are also called out in a banner above the table, because a single bad
row is easy to miss among healthy-looking numbers. A feed reporting **zero** indicators is
highlighted for the same reason. Administrators get a **Reload feeds** button; it reports what
actually happened, including when a reload was refused and the previous indicators were kept.

The same data is available over the API:

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

### Configuring it without a shell

Every setting below can be changed by an administrator under the **settings gear** —
Administration settings → Delivery settings — and takes effect immediately: no file to
edit, no restart. That matters because the person configuring this is usually an IT admin
rather than the developer, and asking them to shell into the host to add a second
recipient makes every tuning change an outage.

The **Delivery** page keeps the half nothing else has: whether delivery is actually
working, and the test send. Editing moved to the gear so there is one place to change
delivery rather than two.

Values resolve in three layers, per field:

```
environment variable   →   stored setting   →   code default
```

**The environment wins.** A deployment driven by Compose or config management keeps its
configuration pinned in a file that a web form cannot contradict — otherwise the file
says one thing, the process does another, and the next redeploy silently reverts
whatever was changed in the UI. A pinned field is shown on the page as locked, with the
variable's name, and the API refuses to store a change to it with a 409: a control that
accepts an edit and changes nothing is worse than one that is visibly disabled.

To manage a setting from the page, remove its variable from `api/.env` — a blank value
counts as unset, matching how every other variable in this project behaves. On first
boot whatever the variables currently say is copied into the database, so removing a
line later keeps the behaviour you had rather than reverting to a default.

> **If you are upgrading from a Compose deployment, this feature was inert for you.**
> `docker-compose.yml` passed every one of these variables through with its code default
> baked in — `:-false`, `:-high`, `:-514` — and a variable that is *set* pins its field.
> So the page reported "16 settings are set in the environment and cannot be changed
> here" on every install, and the file doing the pinning was the one an administrator was
> told not to edit. They are now passed through blank, which means the same values apply
> and the fields are editable. Nothing is lost on upgrade: those values were already
> copied into your settings row at first boot.

Two values are treated as credentials and never returned by the API: the webhook URL,
which *is* the credential for Slack and Teams, and the SMTP password. The form reports
whether each is configured and offers to replace it; an empty box means "leave it
alone", and clearing one is a separate, explicit action.

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

### Teams, and the format that stopped working

Microsoft retired Office 365 connectors in Teams. The supported replacement is a **Power
Automate Workflows** webhook — in Teams, channel → Workflows → *"Post to a channel when a
webhook request is received"* — whose URL lives on `*.logic.azure.com`.

Those are two different payload shapes, not two URLs for one thing. A connector took a
`MessageCard`; a Workflows webhook expects an **Adaptive Card** wrapped in an `attachments`
array. Send the wrong one and you get a rejection or an unreadable message, from the channel
most people configure first and test before trusting anything else.

`NOTIFY_WEBHOOK_FORMAT=auto` sends each host the payload it can actually accept, so **no
action is needed on upgrade either way**:

| Host | Format | What it is |
| --- | --- | --- |
| `*.logic.azure.com` | `teams` — Adaptive Card | A Power Automate Workflows webhook |
| `*.webhook.office.com` | `teams-connector` — MessageCard | A retired Office 365 connector |

The second row is why `auto` does not simply mean "Adaptive Card". A `webhook.office.com` URL
is *definitionally* a connector — connectors can no longer be created, so no new installation
can obtain one — and it rejects an Adaptive Card. Inferring the connector format there is not
guessing at a dead format; it is naming what the URL demonstrably is, and it is wrong for
nobody. `NOTIFY_WEBHOOK_FORMAT` overrides in either direction.

Two consequences worth knowing if you compare the code to the Slack renderer. An Adaptive Card
takes one of six *named* container styles, not a colour, so `SEVERITY_COLOR` cannot express
five severities there — the severity word is printed in every block instead, and the style is a
coarse cue on top of it. And a `TextBlock` renders markdown, so the Teams renderer escapes it
the way the Slack renderer escapes mrkdwn and the email body escapes HTML: evidence can carry a
threat-feed note, which is text taken verbatim from a third-party feed file, and without
escaping a feed line could put a rendered link in your Teams channel attributed to this tool.

### Which SMTP host actually works

In the order that succeeds:

1. **An internal relay.** Most organisations running a monitoring tool already have one, it
   needs no credentials, and it is the right answer for an on-prem sensor. Set `SMTP_HOST`,
   leave `SMTP_USER` and `SMTP_PASSWORD` empty, and the transport omits AUTH entirely.
2. **An app password**, where the tenant still permits one.
3. **OAuth2 / XOAUTH2**, for a tenant that permits nothing else — below.
4. **Your company mailbox with an ordinary password** — this usually fails. Microsoft 365 and
   Google disable basic SMTP AUTH by default on modern tenants, so a *correct* password is
   rejected exactly like a wrong one. When the server returns `535` or nodemailer reports
   `EAUTH`, the delivery result says so rather than passing the raw SMTP string through, because
   "authentication unsuccessful" sends people to check a password that was never the problem.

### OAuth2, when the tenant allows nothing else

`SMTP_AUTH_METHOD=oauth2` switches the transport to XOAUTH2. It is the **refresh-token
grant** and nothing more ambitious: register an application with the identity provider,
consent to it once as the sending mailbox, and paste the refresh token in. Nodemailer
exchanges it for an access token on first use and renews that when it expires, so nothing
here stores or schedules a token.

There is deliberately no authorization-code redirect. That needs a browser round trip
through a publicly reachable callback URL, and this runs on a sensor inside a network — the
one-time consent happens on the administrator's own machine instead, and only its result is
configured here.

| | Microsoft 365 | Google Workspace |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.office365.com` | `smtp.gmail.com` |
| `SMTP_USER` | the mailbox being sent from | the mailbox being sent from |
| `SMTP_OAUTH_TOKEN_URL` | `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token` | `https://oauth2.googleapis.com/token` |
| `SMTP_OAUTH_SCOPE` | `https://outlook.office.com/SMTP.Send offline_access` | not needed — the refresh grant ignores it |
| Permission to grant | Office 365 Exchange Online → Delegated → `SMTP.Send` | `https://mail.google.com/` |

Two things about this fail in ways worth naming in advance, and both are reported rather
than left to be guessed at:

- **Microsoft's per-mailbox SMTP AUTH switch is separate, and OAuth2 does not bypass it.** A
  correctly issued token is still refused with `535` until
  `Set-CASMailbox -SmtpClientAuthenticationDisabled $false` has been run for that mailbox.
  That rejection is the same `535` a wrong password produces, so what the delivery result
  says about it depends on which auth method is in force — the password advice would send
  somebody to check a password that is not being used.
- **A refresh token expires or gets revoked.** The token endpoint's refusal (`invalid_grant`)
  is reported as itself, distinct from a mailbox refusing a token that was issued fine, and
  the provider's own `error_description` is passed through.

`SMTP_OAUTH_TOKEN_URL` has no default on purpose. Nodemailer's own fallback is Google's
endpoint, so a blank value on a Microsoft tenant would post the refresh token to
`accounts.google.com` and return a refusal that names neither problem. It is also the one
URL here restricted to `https:` — the client secret and refresh token are in the body of
every token request — and that restriction applies wherever the value comes from, the
environment variable included, since a value set there cannot be corrected from the UI.

An OAuth2 mailbox missing any of the five required values is not treated as configured, and
the three places that would otherwise say so incorrectly all name the unset variables
instead: the Delivery page reports them rather than its standing "SMTP host, sender and at
least one recipient", a test send lists email as a failed channel rather than leaving it out
of the attempt, and an install with no channels at all is told what it actually needs. No
socket is opened in any of them.

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

## Suppression rules

The feature that decides whether this tool is still switched on in month three.

An authorised vulnerability scanner sweeping the estate every night raises a `high` port-scan
finding every night — correctly. A backup agent enumerating SMB shares raises a host sweep on
port 445 every night, also correctly. With no way to record "yes, I know, that one is
expected", the alerts table fills with known-good noise, the real findings sit underneath it,
and the person on call learns that the alerts do not mean anything. That is the failure mode
that gets a monitoring tool ignored, and it is not a detection problem — the detectors are
right.

A rule is a conjunction of up to four criteria, and any it leaves out means "any":

| Criterion   | Example         | Notes                                                       |
| ----------- | --------------- | ----------------------------------------------------------- |
| Kind        | `port_scan`     | One of the eight detector kinds                             |
| Source      | `10.20.30.0/24` | IPv4 or IPv6, CIDR or a bare address (meaning a single host) |
| Target      | `192.168.1.50`  | Same                                                        |
| Port        | `445`           | Destination port — see the caveat below                     |

Plus a mandatory **reason**, an optional **expiry**, and an on/off switch. Rules are edited on
the **Suppressions** page by an administrator, stored in `alert_suppressions`, and take effect
before the API answers the request that created them.

### A suppressed finding is dropped, not hidden

This is the important thing to understand before writing one, and it is the risky half of the
feature. There is no "show suppressed" toggle, because nothing is stored: the finding never
reaches the alerts table, the webhook, the email digest or the SIEM feed. A rule broader than
its author realised discards real findings and leaves nothing behind to notice.

The converse is worth stating too, because it is the natural misreading: a rule applies where
a finding is **written**, so saving one changes what arrives from now on and nothing that is
already stored. `listAlerts` has no suppression filter. The findings that prompted the rule
stay exactly where they were, and the alert list does not get shorter — which is what the
"Suppress findings like this" confirmation now says, after a first version of it promised the
opposite.

Three things exist to make that visible rather than silent, and they are why the page looks the
way it does:

- **Every rule counts what it hides**, with the time it last fired. "Findings hidden" is a
  headline tile, not a detail column — a rule quietly eating four thousand findings a day
  should not need looking for.
- **A rule in force that has hidden nothing is flagged.** It is either wrong — a typo in the
  range — or no longer needed. Both are worth knowing.
- **Every rule can expire**, so "suppress while the pen test runs" does not become a permanent
  blind spot because somebody forgot. Expired rules stay on the page, labelled, rather than
  being filtered out of sight.

A rule the server cannot use is called out loudly on the page and in the server log, with the
reason next to it, because it matches nothing at all while its author believes otherwise — the
one state here that looks like coverage and is not. Two things put a rule in that state: a
stored range that will not parse, and a `kind` no detector raises. The second is unreachable
through the API, which validates against a closed enum; it exists for the day a detector kind is
renamed, when every rule naming the old one would otherwise stop suppressing in silence.

### Check a rule before you save it

Authoring a suppression is a guess about a range, and the cost of guessing wide is silence
rather than an error message. **Check against recent alerts** in the rule dialog measures the
guess against alerts already stored and reports what it would have hidden:

```
Would have hidden 2 of the last 500 alerts — 4,821 observations in total.
Examined 20/08/2026, 01:00:00 to 27/08/2026, 09:00:00
```

The observation count is the number that matters. Two alerts can carry several thousand
observations between them, so a row count reads as trivial while describing most of the noise
on the network. The window is reported so that a zero is interpretable — nothing matching over
four hours of alerts means something quite different from nothing matching over four months.

It runs the same matching code that does the dropping, not a second implementation. A preview
of different logic would be a preview of nothing.

### Two deliberate limits

**A rule must have at least one criterion.** A rule with none would drop every finding on the
network. Refused at the API boundary and again by a `CHECK` constraint, and `0.0.0.0/0` is
refused with it — "any source" already has a spelling, which is to leave the field empty, so
the only thing a `/0` could add is a way to write a match-everything rule that does not look
like one.

**A port criterion only matches findings about a single port.** A port scan's defining property
is that it touched *many* ports, so no one port describes it; recording the last one observed
would make a rule for port 445 swallow a whole scan that happened to include it. Findings that
name exactly one port — a host sweep of one service, a cleartext login on a service port —
carry it, and only those can be matched on a port. To silence a scanner, name its source range
and the kind instead.

### Where it sits

Suppression is evaluated in one place, `AlertSink.record`, above the aggregation and before
anything is written. Both sources of findings — the packet engine and the flow collector —
reach storage through that method, and notification happens downstream of storage, so one check
covers the alert table, the webhook, the email digest and the SIEM feed together. Suppressing
at the notifier instead would have left the dashboard full of the noise somebody had just
declared expected.

If the rules cannot be loaded, the previous set stays in force and findings get through.
Failing the other way — treating an unreadable rule table as "suppress" — would turn a database
blip into a monitoring outage that looks like a quiet night.

---

## Retention

`alerts` and `known_devices` grow for ever otherwise. One recurring finding writes a fresh
row every `DETECT_ALERT_WINDOW_MS` — five minutes by default — so a vulnerability scanner
that runs nightly is a few hundred rows a day by itself, and `known_devices` gains a row per
MAC address ever seen, which on a network of modern phones means one per phone *per
randomised address*.

```bash
# api/.env
RETENTION_ENABLED=true        # false keeps everything for ever
ALERT_RETENTION_DAYS=365      # full-detail alert rows
DEVICE_RETENTION_DAYS=365     # how long a device is remembered after it was last seen
RETENTION_SWEEP_HOURS=24
```

### Detail expires; the shape does not

The obvious implementation is `DELETE FROM alerts WHERE last_seen < cutoff`, and it would
quietly break the thing this project is most careful about. The dashboard's trend chart reads
`alerts.last_seen`, so a window set to a year would show a flat line before the cutoff —
history that was deleted, rendered exactly like a network on which nothing happened. Keeping
those two states distinguishable is most of what the detectors here are for.

So every expiring day is aggregated into `alert_rollup_daily` — one row per
(UTC day, kind, severity), carrying how many alerts there were and how many observations they
represented — **in the same transaction that deletes it**. Rollups are never pruned, and
`GET /api/alerts/dashboard` reads both, so a window **longer than `ALERT_RETENTION_DAYS`**
still has a trend long after the individual rows are gone.

That emphasis is load-bearing, and getting it wrong once made the whole feature unobservable.
Retention rolls up days *older* than its cutoff, so if the longest window anyone can ask for
is also the retention window, every bucket in `alert_rollup_daily` sits just outside it and the
fold-in is dead code. The dashboard accepts up to five years and the period selector offers 12
months and 5 years for exactly that reason: the reachable window has to be able to reach past
the cutoff.

Sharing a transaction is what makes the sweep safe to retry: rolling up and then failing to
delete would double-count the day, deleting and then failing to roll up would lose it, and
neither is possible if both commit together. One day per transaction rather than one for the
whole backlog, so a failure costs a day of progress instead of the entire reclaim.

Retried, though, not overlapped — the two are not the same. Two sweeps working the same day
both run the aggregate INSERT, because neither sees the other's uncommitted DELETE, and the
additive `ON CONFLICT` sums both while only one DELETE removes anything: that day's bucket is
double for ever. A flag covers this process's own interval firing while a long first reclaim is
still running; a Postgres advisory lock covers a second replica, held on its own connection for
the length of the sweep. `pg_try_advisory_lock`, so a sweep that cannot get it stands down and
lets the next interval try rather than queueing behind a reclaim that may run for hours.

### What the numbers mean after an expiry

The trend and the summary tiles answer different questions once retention has run, and it is
worth knowing before it looks like a bug:

| | Reads | Answers |
| --- | --- | --- |
| Trend chart | live rows **and** rollups | "what did this period look like?" |
| Summary tiles | live rows only | "what is in the table now?" |

The tiles are deliberately live-only. `unacknowledged` has no meaning for a bucket that
records how many alerts a day held rather than what anyone did about them, so folding rollups
in would produce a total the alert list could never account for. An hourly trend window is
also served from live rows alone — a daily rollup cannot be split into 24 equal hours without
fabricating detail that was deliberately discarded.

### Three things it deliberately refuses

**A window under seven days is clamped up, with a warning.** `ALERT_RETENTION_DAYS=1` is a
plausible typo for 10 or 100, and honouring it would delete very nearly every finding on the
next sweep — irreversibly, because the rollup preserves counts and not rows. There is no undo
for that one. Set `RETENTION_ENABLED=false` if the intent is really to keep everything.

**Only the expired part of a day is taken.** A day contains rows on both sides of the cutoff,
so deleting whole days would remove alerts still inside the retention window by up to 24
hours — against the seven-day floor, a seventh of it. Both the aggregate and the delete
require `last_seen < cutoff`, and the rollup's `ON CONFLICT` is additive so the rest of that
day folds in when it expires.

**A sweep interval longer than a timer can hold is clamped down, with a warning.**
`RETENTION_SWEEP_HOURS=720` — a monthly sweep, and a reasonable thing to want — is
2,592,000,000 ms, past the signed 32-bit delay `setInterval` accepts. Node does not reject it
and does not throw: it warns and uses **1 ms**, so the operator who asked for the least
frequent sweep possible would get a continuous one. Clamped to 596 hours, which is the largest
that fits.

### Forgetting a device

`known_devices` has nothing to roll up: it is a set of "we have seen this MAC before", and the
only thing pruning changes is that a returning device is reported as **new**. That is the same
trade `DELETE /api/alerts/devices/:mac` already makes on purpose, and after a year of absence
"this appeared on the network" is arguably true again.

**Absence is what has to be measured, and originally it was not.** New-device detection returns
early for a MAC it already knows — that is the whole point of it — so the only code that ever
wrote `known_devices.last_seen` ran on discovery, and the column meant "first inserted". Pruning
on it would have deleted every device recorded on install day exactly a year later *however
continuously it had been on the LAN*, and the next capture would have re-alerted the whole
network at once. The detector now reports sightings of known devices too, at most one per device
per quarter of an hour — a write per frame for a column read in days would be absurd, and
fifteen minutes of staleness costs nothing against a 365-day window.

**And the two clocks have to be the same clock.** `last_seen` advances only while a capture is
running, and nothing starts one automatically; the sweep starts with the process. On an
installation where captures are run for an afternoon at a time, wall-clock time would march
past a frozen column until the window elapsed and the entire device table went at once — the
same mass re-alert, reached from the other direction. So the cutoff is measured from
`max(last_seen)`, the most recent moment there is any evidence of being on this network: a
clock that stops when we stop listening. Against a table frozen 400 days ago, `now() - 365
days` forgets **4 of 4** devices and `max(last_seen) - 365 days` forgets **1**; with a capture
running, both forget the same one. It is not a full accounting of capture uptime — a
five-minute capture after a year of silence still advances the reference — but it cannot take
the whole network any more.

That reference is measured **per sensor**. Across the whole table it would be one sensor's
clock: a sensor capturing continuously drags the cutoff forward until a quieter one's entire
device list falls behind it and goes in a single sweep, which is the same mass re-alert
arriving from a third direction. See [More than one sensor](#more-than-one-sensor).

Buckets are UTC days, explicitly. `date_trunc('day', ts)` uses the session's `TimeZone`, which
would make the same data roll up differently on two servers — on a machine set to `Asia/Kabul`
a finding at 22:30Z lands in the *next* day. Both the bucket expression and the range bounds
say `AT TIME ZONE 'UTC'`.

---

## More than one sensor

Two installations can point at one database, and until V16 they wrote into each other's rows.

`alerts.dedup_key` was globally unique, and a dedup key is derived from what was observed — a
kind, the addresses involved, a time bucket. Two sensors watching two segments therefore
produce the **same key for two unrelated events**, because a port scan from 10.0.0.1 looks the
same on any network that has a 10.0.0.1. The upsert found the other sensor's row: occurrence
counts added together, `first_seen`/`last_seen` widened to span both networks, and the title,
severity and evidence became whichever sensor flushed last. Nothing reported a conflict,
because at the database level there was not one.

`known_devices` was the quieter half and the worse one. Its primary key was the MAC address
alone, so a phone the first sensor had learned was already "seen before" to every other sensor,
and **new-device detection never fired for it**. A merged alert row is visibly wrong to anyone
who looks at it. A detection that does not happen leaves nothing to look at.

### Naming a sensor

`SENSOR_ID`, in the environment, and it cannot be anywhere else: the database is the thing
being shared, so a stored settings row inside it cannot hold two different answers. It is a
property of the deployment, the way `DATABASE_URL` is. Letters, digits, dot, dash and
underscore, 64 characters at most; anything else is refused at boot rather than trimmed,
because a name that had to be altered to be stored is a different identity from the one that
was configured.

The default is the literal `default` rather than the machine's hostname. A hostname default
looks friendlier and is a trap under Compose, where a container's hostname is a fresh random id
on every recreate — the identity would change behind you, orphaning every stored alert and
re-alerting every recurring finding. So a single-sensor installation is left alone, and you
name the sensors on the day a second one appears.

**Upgrading changes nothing.** V16 backfills every existing row to `default`, which is the same
value the process will use, so alerts stay where they are and recurring findings go on merging
into the rows they were already merging into.

### What is separate, and what is shared

| Separate per sensor | Shared across all of them |
| --- | --- |
| Findings, and their dedup keys | Suppression rules — a rule is a policy statement, not an observation |
| Known devices, and therefore what counts as new | Delivery settings, the query console settings, accounts |
| Daily rollups | The audit trail |
| The sensor name on every notification | Delivery settings — but not the per-process rate limits, which apply per sensor |

Delivery is the case worth spelling out, because the settings are shared and the *sending* is
not. Every notification names its sensor — email, Slack, Teams, Discord and the plain-text digest
all print it, but only once **more than one sensor has written to this database**, since a line
reading "sensor default" on an installation that has only one is noise that trains people to skip
the line the multi-sensor deployments need. That is the same test the alerts page uses to decide
whether to render the sensor column, deliberately: an earlier version keyed on whether the name
was still `default`, which is what ships and what V16 backfills to — so head office kept the
shipped name, added a branch, and only the branch's alerts carried a sensor line. The syslog/CEF
feed carries `dvchost` unconditionally, because a SIEM correlating per segment needs the field
on every event and does its own filtering.

**The rate limits do not combine, and that is worth knowing before it surprises somebody.**
`NOTIFY_MAX_PER_HOUR` and the per-finding throttle are held in memory by one notifier per
process, so two sensors enforce the configured ceiling twice: `NOTIFY_MAX_PER_HOUR=10` with two
sensors is up to twenty messages an hour to the same recipients, and the same finding can page
from both inside one throttle window. Halve the ceiling per sensor, or expect the multiple.

Reads default to **every** sensor. Sharing one database is what makes a second sensor worth
having, and an interface showing only the sensor that happens to be serving it would hide the
other's findings with nothing on screen saying so. The alerts table gains a Sensor column and a
filter, and the dashboard a selector — all of them hidden while only one sensor has reported,
since a column repeating one value costs width and says nothing.

Two consequences worth knowing before they look like bugs:

- **Clear All crosses sensors.** The control means "empty this table", and one that quietly
  left another sensor's rows behind would be a button whose name is false. What it does instead
  is name the sensors in its audit entry, so the trail records that somebody sitting in front
  of one sensor removed another's findings.
- **Forgetting a device does not.** Re-arming new-device detection on a segment nobody is
  looking at is a different act from the one the button offers, so it never happens by
  default: the sensor is *resolved* rather than assumed. One sensor knows the address and
  that row goes; several know it and the request is refused, naming them, because choosing
  is the caller's decision; naming a sensor that does not hold it says so rather than
  claiming the device is unknown. Every one of those is the same rule — the row that goes is
  a row somebody asked for.

### Running two

Each sensor is a full installation — its own API, its own capture — with `SENSOR_ID` set and
`DATABASE_URL` pointing at the same Postgres. Nothing else is coordinated: there is no
registration step and no leader. A sensor is whatever has written a finding, which is why the
sensor list cannot drift from the data and why decommissioning one is deleting its rows rather
than remembering to tell a registry.

The retention sweep stays database-wide rather than per sensor. Retention is a property of the
database, one sweep is cheaper than one per sensor, and two sweeping at once is already safe
for the same reason a repeated sweep is: the rollup's `ON CONFLICT` adds.

---

## Audit trail

Who deleted the finding.

The application already recorded identity where somebody had thought of it — who
acknowledged an alert, who wrote a suppression rule, who last changed the delivery
settings — with three copies of the same helper in three routers, one of them commented
*"Same form the alert acknowledgement uses"*. What none of them covered was any action that
**removes or redirects** something:

| Action | Recorded who, before |
| --- | --- |
| Acknowledge a finding | yes |
| Reopen a finding, clearing who acknowledged it | **no** |
| Write a suppression rule | yes |
| Change the delivery settings | yes |
| Delete a finding | **no** |
| Clear every finding | **no** |
| Forget a device | **no** |
| Delete a suppression rule | **no** |
| Write to the legacy packet log | **no** |

That gap matters more here than in most applications, because the thing being deleted is
evidence. "Who removed this finding, and when" is the first question asked after an
incident, and the answer was unavailable *permanently* — the row was gone and nothing else
knew it had existed. A tool that watches a network and cannot say who told it to stop
watching part of one is answering the easier half of the question.

`GET /api/audit` reads the trail; **Activity** in the sidebar shows it. Both are ADMIN.

### Append-only, enforced by the database

Not by convention. A trigger refuses `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events`,
so tampering requires dropping the trigger — an act that is itself visible in the schema.
There is no code path that modifies a row, and the database would refuse one if there were:

```
UPDATE                    → refused: audit_events is append-only; UPDATE is not permitted
DELETE (matching rows)    → refused: audit_events is append-only; DELETE is not permitted
DELETE (matching nothing) → refused
TRUNCATE                  → refused
```

The third line is the interesting one — a `DELETE` that would remove nothing is still
refused, because the intent is what is being rejected and a row-level trigger would let it
through silently having done nothing.

Retention never prunes it either. The sweep names the tables it works on and this is not
one of them: a record of a deletion that expires alongside the thing deleted is the same
hole in slower motion.

### The record and the act commit together

`recordAudit` takes the writer to use, so a caller inside `db.transaction` passes its `tx`
and the deletion and its record land atomically. This is the argument the retention sweep
makes about rolling up and deleting — doing the work and recording the work are one thing,
and every way of splitting them is wrong in one direction:

- record first, and you can log a deletion that never happened;
- record after, and you can delete without a trace.

It also disposes of the question every audit implementation otherwise has to answer badly:
*should a failed audit write fail the action?* Sharing a transaction means the question
cannot arise.

### Identity is required, not remembered

Every mutating service function takes an `actor`. That is a type signature, so the compiler
asks the question at each call site rather than leaving it to whoever remembers — the gap
above existed precisely because nothing asked. `actorOf` is the single copy of the
identity form, and the three duplicates are gone.

A blank email counts as no email, matching how `env.ts` treats a blank value everywhere
else. The first version used `??`, which only falls back on null, so an account with an
empty email produced `''` — and because `actor` is `NOT NULL` with a non-blank CHECK inside
the caller's transaction, that would not have surfaced as a bad audit row. It would have
aborted the deletion and reported a database constraint to somebody trying to delete a
finding. A test found it before a user did.

### What an entry carries, and what it must not

A deletion records what was deleted, not just its id. "Alert 412 was deleted" answers
almost nothing a year later, so the entry holds the finding's kind, severity and title —
once the row is gone this is the only surviving description of it. A bulk clear records
counts by severity instead: putting thousands of titles into a table that cannot be pruned
is a different mistake.

**No entry ever holds a credential.** The delivery settings include a webhook URL — which
is a bearer token in a query string — and an SMTP password, so a settings change records
*which fields* changed and never their values. An audit trail that quietly became a second
place to read credentials, unprunable and readable by any administrator, would make the
system less safe rather than more accountable. The redaction is a one-line function on
purpose: exported, so a test can assert the property rather than trust the call site.

### What this does not yet cover

`POST /api/packets/clear` and `/stop` are ADMIN-only and both discard something — captured
packets, an in-progress observation — but neither is in the audit vocabulary. They operate
on the capture buffer in memory rather than a database row, which is a different shape of
action from everything above: there is no transaction for a record to share, so closing
this gap means deciding how an audit write commits alongside an in-memory action rather
than reusing the pattern the rest of this trail relies on. Worth doing, not yet done.

---

## Ad Hoc Query

The question no screen was built for.

Every other page here answers something somebody designed a page for. This one is where an
administrator goes when the shape of what they need is not one of those, and the alternative
is a `psql` session on the server or an export nobody has written.

**It is off by default**, and that default is the important one in this repository. Switched
on without thought, a SQL console is a prompt on the production database reachable from a
browser session.

### What makes it safe is not in the application

There is no validation of the SQL. Deliberately: app-side checking does not hold — a CTE
carries DML, a comment or a string literal hides a keyword, `;` chains a second statement —
and writing a check invites the belief that it is doing something. Postgres already has an
authorisation system that gets all of this right, so the console borrows it rather than
reimplementing a worse one.

The console authenticates as a dedicated role whose name is **derived, never configured**:

| Mode | Role | May |
| --- | --- | --- |
| default | `nm_adhoc_<database>` | `SELECT` only |
| `ADHOC_WRITE_ENABLED=true` | `nm_adhocrw_<database>` | `SELECT`, plus write on the operational tables |

There is no connection-string setting on purpose. One would be one an operator could point
at `postgres` — the owner this application connects as, a superuser in the default Compose
file — turning every restriction off while the feature still appeared to work.

### Switching it on

Under the **settings gear**, visible to administrators only, there are two tools:

- **Query console** — whether it is running, and if not, which of three reasons: nobody
  asked for it, there is no password to install on the role, or the database would not
  confirm the role is sandboxed. It also re-runs the startup check, for the case where the
  role's grants were wrong and have since been fixed. Previously all three states shared
  one sentence and the only way to tell them apart was the server log.
- **Query console settings** — the switches and limits, in force on save. No restart, which
  on a monitoring server would mean dropping a live capture to reconfigure a console.

The password is there too. It was environment-only at first, on the argument that it was
what kept the decision to *have* a SQL prompt on the production database with whoever
installed the server — an accurate description of what changed, and the trade was made
deliberately so an administrator can provision the console without server access. What
holds the line instead:

- **The environment still wins.** `ADHOC_DB_PASSWORD` set in the environment pins the
  field: the control renders disabled and the API refuses a change with a 409. An
  installation that wants the original behaviour sets the variable, and no browser session
  can contradict it.
- **The console cannot read the table its own credential is in.** V11 and V12 grant the
  console roles an explicit per-table allowlist; `adhoc_settings` is in neither, and V15
  revokes on it as well so a future blanket `GRANT` has to override a statement rather than
  fill a silence. There is a standing test that asserts this against the real grants.
- **It never leaves the server.** The API reports whether a password is set, never what it
  is — redacted in the resolver rather than at the route, so a later endpoint cannot leak it
  by forgetting. The audit trail records that the password changed, never the value: it is
  append-only and never pruned, so a credential written there is written for good.
- **An empty box means "leave it alone".** Since the value is never returned, a configured
  password and an emptied field look identical; clearing is a separate button, so the
  destructive reading is never the one that happens by accident.

> **Removing the variable is not the off switch.** Whatever the environment said is
> copied into the stored settings at first boot — so deleting `ADHOC_ENABLED` or
> `ADHOC_DB_PASSWORD` later leaves the row holding the copy, and the console goes on
> running. That is the seeding rule working as designed (deleting a line keeps the
> behaviour you had), but for the two fields that decide whether a browser can run SQL it
> is the opposite of what most people will expect. To turn the console off, set
> `ADHOC_ENABLED=false` explicitly, or switch it off in the interface.

One thing deliberately did not become editable:

- **Write mode still forces auditing to `all`.** A console that can `DELETE` and a trail
  that records none of it was previously unreachable only because both flags came from the
  environment and had to be set together on purpose. Now that either can be set in a
  browser, the rule is applied where both are read.

Every field says where its value came from, and one the environment pins is shown disabled
with the variable named — the same contract as the delivery settings, for the same reason: a
control that accepts an edit and changes nothing is worse than one that is visibly locked.

Neither role can:

- **read the columns holding secrets** — `users.password`, `delivery_settings.email_password`,
  `webhook_url`. Excluded at the *column* level, so `SELECT * FROM users` is refused outright
  rather than quietly returning the hash. A read-only console that can select a webhook URL
  has exfiltrated a bearer credential just as thoroughly as one that could write.
- **write `audit_events`** — reading it is granted, since a console that cannot search the
  trail is a poor tool for the person searching it; no write grant exists in either mode, so
  the trail stays append-only even in write mode and the console's own use remains
  investigable. It writes an entry for every query it runs.
- **change `users` or `delivery_settings`** — both have their own screens and their own audit
  entries; a console `UPDATE` there would change who can log in, or where findings are
  delivered, with no record beyond the query text.
- **act as a superuser** — `COPY … FROM PROGRAM` is command execution on the database host,
  and `pg_read_file` reads its filesystem. That is the difference between "can edit rows" and
  "has the server".

Write mode grants `INSERT`/`UPDATE`/`DELETE` on the operational tables only: findings, known
devices, suppression rules, the legacy packet log and the daily rollup. Sequences get `USAGE`
and `SELECT`, never `setval`.

### It proves the cage at boot rather than assuming it

Every control above is invisible when it fails. A migration that did not run, a grant an
operator "fixed" while debugging, a role recreated by hand — each leaves a console that works
perfectly and is wide open, and nothing on screen looks different.

So on startup the console asks the database to confirm it is caged: that the role is not a
superuser, that it cannot read `users.password`, and — depending on the mode — that it either
cannot write at all, or can write while still being refused by `audit_events`. If any answer
is wrong the feature stays off and says why. A feature that quietly did not start is a smaller
problem than one that quietly did.

### Around the role

The things a grant cannot express: a separate two-connection pool, so a slow query cannot
starve the pool detection and alerting share; a statement timeout, so a cartesian join stops
instead of running until somebody notices; a row cap applied with a cursor, so the SQL is
never rewritten; and `EXPLAIN`/`SHOW` run unwrapped inside the same transaction, timeout and
role, because a cursor cannot hold them and a syntax error about SQL that has none is the
worst thing to hand somebody who has just hit the timeout.

`POST` is used for a read, which is not the mistake it looks like: a query string is written
into the access log of every proxy in between, and into browser history. Neither is somewhere
a `SELECT … FROM users` belongs, even a permitted one.

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

Under Docker, publishing the UDP port is a separate opt-in:

```bash
docker compose -f docker-compose.yml -f docker-compose.flow.yml up -d
```

It is separate because `ports:` binds the host port whether or not anything inside
the container is listening. Putting it in the main file would open `2055/udp` on
every deployment — including the default one with `FLOW_ENABLED=false`, which is
exactly what that setting exists to prevent — and would break `up` outright on a
host already running a NetFlow collector on that port.

Then point the device at it. On pfSense/OPNsense that is the softflowd or ipfix service; on
Cisco, `ip flow-export destination <collector> 2055`; on UniFi and Meraki it is a field in the
controller UI.

Check it is arriving on the **Flow collection** screen, under Capture in the navigation. It
names whichever of the setup failures applies rather than leaving you to infer it from counters:

- **Listening, and nothing has arrived yet** — reachability. The device is not sending, cannot
  reach this host, or is sending somewhere else.
- **Receiving, but every record is waiting for a template** — the sharp one. A v9 or IPFIX
  exporter that sends data records before the templates describing them is counted in
  `datagrams`, decodes nothing, and is indistinguishable from a working device in any total.
- **Flow collection is on, but the socket is not open** — the bind failed. The port is taken, or
  `FLOW_BIND_ADDRESS` names an address that is not on this host. This is why `enabled` and
  `listening` are two fields and not one on/off.
- **Datagrams discarded** — broken out by cause, because the three have nothing to do with each
  other: a sender the allowlist refuses (shown beside the permitted list, which is the whole
  diagnosis), a device configured for sFlow, and a version with no parser.

The same numbers are available directly, and the per-exporter breakdown is the point of the
endpoint:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/flow/status
```

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
npm test          # both suites
npm run test:api  # the API suite, several hundred cases
npm run test:ui   # the UI suite
```

Neither suite needs a browser or a running server. Almost none of it needs a database
either — decoders, detectors and guards are pure, and mocking a database to assert what
SQL would do only tests the mock.

The exception is the handful of suites whose subject **is** the SQL: aggregate a day and
delete it in one transaction, a trigger that refuses an `UPDATE`, a role check that has to
read a user row. Those cannot be covered any other way, and until recently they were not
covered at all — they were probes run by hand once and then trusted, which is how retention
shipped four SQL bugs that review caught and no test could have.

Those suites now run against a real Postgres, and they **skip** when none is reachable, so
`npm test` still works on a machine without one. The skip is not allowed to be silent:

```bash
# Uses your DATABASE_URL's credentials against a separate <name>_test database,
# creating it if it does not exist. Never touches your dev database.
npm run test:api

# What CI runs. An unreachable database is now a failure, not a skip.
REQUIRE_DB_TESTS=1 npm run test:api
```

`REQUIRE_DB_TESTS=1` is the promise that those suites ran, and CI sets it —
`ci-requires-database.test.ts` is the standing check that it still does. Without that, a
green tick would mean "nothing failed" and "nothing ran" indistinguishably, which is exactly
how the glob bug below ran 456 of 496 tests for as long as it existed.

The harness refuses any database whose name does not end in `_test`, because it truncates
every table between suites and the cost of getting that wrong is somebody's data.

Exact counts are deliberately not printed here. They were, and they went stale in four
consecutive pull requests — the last time hiding a dropped file, since the number was the only
evidence anything was missing. A figure nobody can keep true is worse than no figure: run the
suite, which prints its own.

### API tests

Over `api/src/packet/`, `api/src/flow/`, `api/src/intel/`, `api/src/notify/` and
`api/src/routes/`, covering the hand-written decoders, every detector, the NetFlow/IPFIX
parsers, indicator matching and feed loading, the notification gate, request validation, and
the FFI binding. They use Node's built-in test runner, so there
is no framework to install. The FFI tests skip themselves when no pcap library is present.

The groups worth knowing about:

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
- **Suppression matching** pins what a rule covers, and every case is really the same question
  asked from a different angle: does this rule hide more than its author wrote down? A rule
  naming a source range must not match a finding that has no source; a rule naming a port must
  not match a port scan; `0.0.0.0/0`, a range that will not parse and a `kind` no detector
  raises must all be refused rather than treated as "any"; and the expiry has to be re-read per
  finding, so a cached rule set stops suppressing at the right moment. Several of those guards
  were verified by reintroducing the bug and watching them fail.
- **Authorisation, three ways.** Each catches something the other two cannot, and the gaps
  between them are where the two real holes described below were living.

  1. **The routing table** (`src/routes/route-guards.test.ts`) asks whether a guard is
     *installed*: auth on everything, and a role gate on everything that changes state, with an
     exemption list that has to be typed out next to its reason. The recurring mistake in this
     codebase is the fix that stops one step short, and it is invisible to a unit test of the
     guard itself, which passes either way. Three subtleties it has to get right: a guard can be
     installed away from the route it protects (`router.use(['/start', '/stop'],
     requireRole('ADMIN'))`, which is how the capture router gates); admitting ADMIN is not the
     same as requiring it, so the check asks whether a covering guard admits that role *and
     nothing else*; and authentication is asserted per route rather than per router, because
     `authRouter` cannot use `router.use(requireAuth)` — login has to stay reachable — so it
     names the middleware on the individual routes that need it.

     It also reads its own directory. Every `*.routes.ts` file has to appear in the posture
     table with the exemptions it claims, so adding a router means declaring what it lets
     through instead of quietly going unchecked. That check is what turned up the two holes:
     the file had grown one router at a time and five of the eight had no coverage at all.

  2. **Real HTTP** (`src/routes/auth-rejection.test.ts`) asks whether the installed guard
     *works*. A `requireAuth` that accepted an expired token, or one signed by somebody else,
     or an unsigned one, would leave the table check entirely green — the middleware is present
     everywhere it is supposed to be. So this starts the app on a real port and sweeps all 42
     authenticated routes with seven credentials that must each come back 401: no header, the
     wrong scheme, a token that is not a JWT, one signed with a different secret, an expired
     one, an unsigned `alg: none` token, and one signed with HS256 instead of the HS512 this
     server pins. It needs no database, because none of the seven ever reaches a handler.

     The route list is pinned rather than derived, and that is the interesting part. Deriving
     the targets from the routing table means a router that *loses* `requireAuth` stops being a
     target and the suite still passes — which is what the first version did: deleting
     `alertsRouter.use(requireAuth)` left all eleven tests green while nine routes went open.
     A suite that shrinks silently when the thing it guards is removed reports success at the
     moment it stops looking.

  3. **The guard itself** (`src/middleware/role-guard.test.ts`) covers the case neither of the
     others can reach: a caller who *is* authenticated and simply is not allowed. Getting past
     `requireAuth` means a user row and therefore a database, so `requireRole` is driven
     directly. Three outcomes, and they have to stay distinct — 401 for nobody, 403 for the
     wrong somebody, `next()` for the right one. Answering 403 to an anonymous caller tells
     them a credential would get them further; answering 401 to a signed-in user sends the UI
     to the login screen and makes a permissions problem look like an expired session.

  **What this found.** `DELETE /api/alerts/:id` deleted a finding for any signed-in account
  while `DELETE /api/alerts` beside it required ADMIN — so the gate on the bulk route bought
  nothing, since the same account could delete the same rows one at a time. And the legacy
  `logs` CRUD (`POST /log/add`, `PUT /log/:id`, `DELETE /log/:id`) let any authenticated user
  add a fabricated record of network traffic, rewrite one, or delete one. On a tool whose
  output is evidence, both are a different kind of act from acknowledging a finding. The alert
  delete is ADMIN now; the three `logs` writes were made ADMIN, then removed outright, which is
  the fix the guard was standing in for. Reading stays open, which is the point of keeping the
  table.
- **The audit trail** (`src/services/audit.test.ts`) pins the parts that fail quietly. The
  action vocabulary is checked against the CHECK constraint *read out of the migration* rather
  than a second copy of the pattern — an action the database would reject fails at the moment
  somebody deletes a finding, on the path where the exception aborts the deletion too. And a
  settings entry is asserted to carry field names and no values, for every field: the trail
  cannot be pruned, so anything that leaks into it is there for the life of the installation.
  The transaction half — delete the row, append the record, both or neither — is verified
  against a real database, including that the append-only trigger refuses a `DELETE` matching
  no rows.
- **Retention** (`src/services/retention.test.ts`, `src/config/retention-floor.test.ts`) covers the
  parts that do not need Postgres, which is where the failures that would hurt live: a disabled
  sweep must report that it *skipped* rather than that it found nothing, must delete nothing when
  called directly, and must schedule no timer — asserted on `startRetention`'s return value, not
  on the process's handle count, because the timer is `unref`'d and an earlier version of that
  test passed with the disabled check deleted. Plus the seven-day floor clamping a slipped digit
  and saying so, while leaving a legitimately short window alone. The SQL half — aggregate a day,
  delete it, both in one transaction — is verified against a real database rather than a mock.
- **Repository-configuration guards** compare a config file against the repo it governs, in
  text, because the failure they catch is a comment asserting something the configuration
  underneath does not do. `test-glob.test.ts` is the starkest of them: `test:api` passed its
  `api/src/**/*.test.ts` glob to the shell unquoted, and because npm runs scripts through `sh`
  on Linux — which has no globstar — `**` collapsed to `*` and the pattern only reached depth
  two. CI ran **456** of 496 tests, green, for as long as that script existed, and the file it
  silently dropped was the detector suite: the attack simulations and the false-positive guards
  described above. It looked correct locally because cmd.exe does not glob at all, so the
  pattern reached the test runner intact — and it is `node --test` that understands `**`, not
  `tsx`, which merely forwards to it. That makes the fix a Node-version dependency: on Node 20
  the quoted pattern arrives as a literal path, matches nothing, and the runner exits **0**, so
  `engines` now requires 22. The guard asserts the glob stays quoted in every script that runs
  the runner, and that each pattern still reaches every test file — its first version compared
  only the text to the left of `**`, so a `*.spec.ts` typo in the other half passed it.
  `env-defaults.test.ts` holds `.env.example` and Compose to env.ts's
  own defaults; `dependabot-config.test.ts` holds `.github/dependabot.yml` to its own header —
  every ecosystem capped and grouped explicitly, every `0.x` production dependency excluded
  from the production group (a breaking `0.x` bump reads as a *minor* to Dependabot, so it
  would otherwise be swallowed by a group), and the security-bypass guarantee never asserted
  without naming the repository setting it depends on.
- **Indicator refusals** are the threat-intelligence equivalent of the false-positive guards.
  A feed line that is *nearly* an indicator must be refused rather than guessed at, because a
  wrong indicator produces a confident false alarm: `999.999.999.999` must not be accepted as
  a domain, `1.2.3.0/` must not parse as `/0` and match the whole internet, and a stray colon
  in an IPv6 literal must not be quietly rewritten into a different, valid address.

The credential tests also assert that no password appears anywhere in a finding, including its
base64 form.

The IPv4/TCP fixture is rebuilt byte-for-byte from a row the Java app wrote to the `logs`
table, so the expectations are Pcap4J's own output rather than this implementation's.

### UI tests

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
- **Delivery settings** (`src/components/DeliverySettingsForm.test.tsx`): a field pinned in the
  environment rendered disabled and naming its variable, a secret never displayed and only
  replaceable, a save that sends *only* what changed — including a field typed and put back
  again, which is the case that separates "only what changed" from "whatever was touched" —
  clearing a text field to null rather than to an empty string, and the server's own refusal
  shown verbatim rather than replaced with "could not save".
- **Suppressions** (`src/pages/SuppressionsPage.test.tsx`): what each rule covers as one line,
  the total hidden, a rule in force that has hidden nothing, a rule the server could not parse,
  an expired rule told apart from a switched-off one, the preview reporting observations rather
  than a row count, and the edit controls being absent for a non-administrator.
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
| `PATCH` | `/users/:id/role` | ADMIN | Change one account's role. Refuses demoting the last administrator, and refuses self-demotion |

Role used to be settable only in the database, so "give this person admin" was a job for
whoever had a `psql` session. It is now **Administration settings → Users and roles**,
audited with who changed it and which way the role moved.

Three refusals, each a lockout it prevents:

- **The last administrator cannot be demoted.** Enforced in a transaction with the admin
  rows locked, because a count-then-update loses the race between two administrators
  demoting each other — both read two admins, both pass, both writes land, and the
  installation has no administrator without either person doing anything wrong. There is
  a standing test that runs that race.
- **Nobody may demote themselves.** Refused even where another administrator exists and
  it would be recoverable: the session doing it loses the page it is standing on, and the
  remedy is the same either way.
- **An unknown account is a 404**, so a stale list cannot report a change it did not make.

### Security alerts — `/api/alerts`

| Method   | Path                    | Purpose                                                |
| -------- | ----------------------- | ------------------------------------------------------ |
| `GET`    | `/`                     | Findings, most urgent first. Filter by `severity`, `kind`, `sensor`, `since` (ISO or `24h`), `acknowledged` |
| `GET`    | `/summary`              | Counts by severity and detector, for the dashboard tiles (`sensor`) |
| `GET`    | `/sensors`              | Every sensor with findings, devices or rollups here, and which one is answering |
| `GET`    | `/sensors/retirable`    | Sensors that could be decommissioned, with what is under each (ADMIN). Excludes this installation |
| `GET`    | `/dashboard`            | Summary plus trend buckets and top sources (`days`, `bucket`, `sensor`) |
| `GET`    | `/devices`              | MAC addresses seen on the network (`sensor`)            |
| `POST`   | `/:id/acknowledge`      | Mark a finding as handled                               |
| `POST`   | `/:id/unacknowledge`    | Reopen it                                               |
| `DELETE` | `/:id`                  | Delete one finding (ADMIN)                              |
| `DELETE` | `/`                     | Clear all findings (ADMIN)                              |
| `DELETE` | `/devices/:mac`         | Forget a device, so it is reported as new again (ADMIN). `sensor` picks the row; without it, the single holder is resolved and several are a 400 |
| `DELETE` | `/sensors/:sensorId`    | Decommission a sensor: its findings, devices, rollups and capture session, in one audited transaction (ADMIN). 404 for a name with nothing under it; 409 for this installation, for a sensor still writing, and while the retention sweep holds the rollup lock |

`DELETE /sensors/:sensorId` has three refusals, and they are the interesting part.

**This installation.** Its detectors are running, so the rows come back — a device on the next
frame, a finding on the next detection — leaving a half-emptied sensor and no error to explain
it. And `known_devices` is what `NewDeviceDetector` treats as already-known, so emptying it
for a live sensor re-arms new-device detection across the whole segment: the next few minutes
are a flood of findings about machines that have been there for months. Clearing findings has
its own route; this one is for a name nothing will write again.

**Another sensor that is still writing.** The same objection on a host the operator cannot
see, and the one this action's own deployment model creates: a shared database is the point of
`sensor_id`, so the list offers every *other* installation, and comparing against `SENSOR_ID`
protects only the one serving the request. A sensor heard from within the last fifteen minutes
is refused. `GET /sensors/retirable` reports `active` for the same reason, so the interface
disables the control rather than offering a guaranteed refusal.

Two things that guard is not. An open `capture_session` row is **not** evidence of liveness:
`stopped_at IS NULL` means "was capturing when that process last had an opinion", which is
exactly what a host that died mid-capture leaves behind — it is the interruption marker, and
treating it as liveness would refuse to retire the crashed sensor this feature is mostly for.
And the recency window is a guard against an operator mistake, not a guarantee: a sensor
running on a segment with no traffic at all for fifteen minutes still looks retired, and
nothing in the database can tell those apart. Closing that would need the sensors to
heartbeat, which is a schema change and separate work.

**A retention sweep in progress.** Both hold `ALERT_ROLLUP_LOCK_KEY`, because they race in a
way neither can see: under READ COMMITTED the sweep's aggregate INSERT still sees alerts the
decommission has deleted and not committed, so it writes `alert_rollup_daily` rows for the
sensor being retired — invisible to the decommission's own rollup delete, which has already
run. Both commit, and the sensor is back in `listSensors` with nothing but buckets while the
audit row says all four tables were emptied. The decommission takes the lock with
`pg_try_advisory_xact_lock` and reports rather than waiting, the same call `lockedSweep` makes
in the other direction: a reclaim can run for hours and an operator's request must not hang
behind one.

### Audit trail — `/api/audit`

Append-only and ADMIN-only. There is no write endpoint, and there should never be one: the
table refuses `UPDATE`, `DELETE` and `TRUNCATE` at the database level.

| Method | Path       | Purpose                                                          |
| ------ | ---------- | ---------------------------------------------------------------- |
| `GET`  | `/`        | Entries, newest first. `action` filters, `before` pages (keyset on `id`), `limit` up to 200 |
| `GET`  | `/actions` | The action vocabulary and its labels, so the filter cannot drift from the server |

### Ad Hoc Query — `/api/adhoc`

ADMIN-only, and off unless `ADHOC_ENABLED` is set. Runs as a dedicated Postgres role rather
than as the application's own connection — see [Ad Hoc Query](#ad-hoc-query) for what that
role may and may not do.

| Method | Path     | Purpose                                                             |
| ------ | -------- | ------------------------------------------------------------------- |
| `GET`  | `/`      | Whether the console is usable, so the page can explain itself rather than render an editor whose every query answers 503 |
| `POST` | `/query` | Runs one statement. `POST` for a read on purpose: a query string reaches the access log of every proxy in between, and browser history |

`POST /query` answers `400` for a rejected query — including Postgres's own message verbatim,
because "permission denied for table users" tells an administrator exactly which rule they met
— `503` when the console is off or both its connections are busy, and `403` for anyone who is
not an ADMIN.

### Suppression rules — `/api/suppressions`

Findings the operator has declared expected. See [Suppression rules](#suppression-rules) for
what a rule means and why a suppressed finding is dropped rather than hidden.

| Method   | Path       | Purpose                                                              |
| -------- | ---------- | -------------------------------------------------------------------- |
| `GET`    | `/`        | Every rule, with the ids of any whose range will not parse            |
| `POST`   | `/`        | Create a rule; in force before this answers (**ADMIN only**)          |
| `PATCH`  | `/:id`     | Partial update — omitted field left alone, explicit `null` clears it (**ADMIN only**) |
| `DELETE` | `/:id`     | Delete a rule, discarding its match count (**ADMIN only**)            |
| `POST`   | `/preview` | What an unsaved rule would have hidden, against stored alerts          |

Reading is open to any authenticated account, on the same reasoning as the alert list: anyone
who can see every finding on the network should be able to see which of them are being
discarded. Writing is ADMIN-only, because a suppression rule is the one piece of configuration
here that can make the tool go quiet. `/preview` changes nothing and is deliberately not
restricted — it is what turns "I think this covers the scanner" into a number before the rule
is saved.

### Legacy packet log — `/api`

The per-packet anomaly log that `alerts` supersedes. Nothing writes to it any more, and
nothing can: the read remains so existing history stays reachable, and that is all there is.

| Method | Path    | Purpose                                |
| ------ | ------- | -------------------------------------- |
| `GET`  | `/logs` | All historical records                 |
| `POST` | `/logs` | Same as `GET` (kept for compatibility) |

`POST /log/add`, `PUT /log/:id` and `DELETE /log/:id` are **gone**, not gated. Rows in this
table are a record of what was observed on the network; an endpoint that can add a fabricated
one or rewrite one existed only so that it could be protected, and it went through three
rounds of that — anonymous, then authenticated, then ADMIN-only and audited — without anybody
asking whether it should exist. Removing the surface is the one change no later refactor can
undo.

The three `log.*` audit actions are still in the vocabulary. The trail cannot be pruned, so
rows those endpoints wrote are still there; dropping the entries would have unlabelled them
and taken the values out of the `action` filter, which is the failure V9's own docblock
predicts. They live in `RETIRED_AUDIT_ACTIONS` instead — labelled and filterable, and not part
of the type `recordAudit` accepts.

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

Not admin-only, deliberately, and recorded as this router's posture in `route-guards.test.ts`:
whether the collector is listening is not privileged, and the operator watching the network is
usually not the administrator.

Three details in the response shape exist because a total cannot answer the question underneath
it. **`enabled` and `listening` are separate** — the first is what `FLOW_ENABLED` says, the
second whether the socket actually opened, and they differ exactly when the bind failed.
**`ignoredReasons` breaks `ignored` into three** — allowlist, sFlow, unimplemented version —
each fixed on a different box, which is the same complaint this route's docblock makes about
record totals one level up. And **`allowedExporters` is reported** so a refusal can be acted on:
"412 datagrams refused" names a problem, and the permitted list beside it names the cause.

### Threat intelligence — `/api/intel`

| Method | Path      | Purpose                                                        |
| ------ | --------- | -------------------------------------------------------------- |
| `GET`  | `/status` | What is loaded, per feed, and whether it came from network/cache/file |
| `POST` | `/reload` | Re-read every feed now (**ADMIN only**)                         |

### Notifications — `/api/notify`

| Method | Path        | Purpose                                                          |
| ------ | ----------- | ---------------------------------------------------------------- |
| `GET`  | `/status`   | Channels configured, gates in force, what has been sent this hour |
| `GET`  | `/settings` | Every delivery setting, with where each came from                 |
| `PUT`  | `/settings` | Change stored settings; in force before it answers (**ADMIN only**) |
| `POST` | `/test`     | Send a test message to every channel (**ADMIN only**)             |

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
    net/prefix.ts             IPv4/IPv6 CIDR parsing and containment, normalised
    networkservices/          Reverse DNS, WHOIS, ip-api.com geolocation
    routes/                   Express routers
    services/
      alert.service.ts        Aggregates findings into deduplicated alerts; the one
                              place a finding can be suppressed
      suppression-rules.ts    Rule matching — pure, no database, exhaustively tested
      suppression.service.ts  Rule storage, the hot-path cache, match accounting
      device.service.ts       Persists known MAC addresses
      packet-capture.service.ts  Capture lifecycle and the poll loop
network-monitoring-ui/        React + TypeScript + Vite frontend
  src/
    api/                      Axios client and typed endpoint wrappers
    components/               AppLayout, AlertSummaryTiles, SeverityChip, CaptureToolbar,
                              PacketTable, IpInfoDialog, HexDump
    hooks/                    usePacketCapture, useIpInfo
    pages/                    AlertsPage, SuppressionsPage, DeliveryPage, ThreatIntelPage,
                              DashboardPage, PacketCapture, PacketCaptureWithIP
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
| `SENSOR_ID`            | `default`                                      | Which sensor this is. Only matters when two installations share one database — see [More than one sensor](#more-than-one-sensor) |
| `JWT_SECRET`           | *required*                                     | Server will not start without it               |
| `JWT_EXPIRES_IN`       | `1d`                                           |                                                |
| `CAPTURE_BUFFER_SIZE`  | `5000`                                         | Packets held in memory per capture             |
| `CAPTURE_POLL_INTERVAL_MS` | `10`                                       | How often a running capture is drained         |
| `REDACT_PACKET_PAYLOAD` | `true`                                        | Blanks packet payloads in API responses — see below |
| `TRUST_PROXY`           | `false`                                       | Read the client IP from `X-Forwarded-For`. On under Compose, off for a direct host install |
| `ARP_TRUSTED_MAPPINGS` | —                                              | `ip=mac,ip=mac` pairs treated as authoritative  |
| `FLOW_ENABLED`         | `false`                                        | Receive NetFlow/IPFIX. Off by default — it opens a UDP port |
| `FLOW_PORT`            | `2055`                                         | 4739 is IANA's for IPFIX                       |
| `FLOW_BIND_ADDRESS`    | `0.0.0.0`                                      | Narrow to a management interface in production  |
| `FLOW_EXPORTERS`       | — (any source)                                 | Comma-separated allow-list of exporter addresses |
| `ADHOC_ENABLED`        | `false`                                        | The SQL console. Off by default: switched on without thought, it is a prompt on the production database reachable from a browser session |
| `ADHOC_WRITE_ENABLED`  | `false`                                        | Lets the console write. Selects a different Postgres role rather than relaxing a check in the app |
| `ADHOC_DB_PASSWORD`    | *required when enabled*                        | Set on the console's role at boot. Settable in the interface too; setting it here pins it there |
| `ADHOC_AUDIT`          | `all`                                          | `all` / `refused` / `off`. Forced to `all` while writes are enabled |
| `ADHOC_TIMEOUT_MS`     | `10000`                                        | A query stops here rather than running until somebody notices |
| `ADHOC_MAX_ROWS`       | `1000`                                         | Rows returned to the browser. A grid, not an export |
| `ADHOC_MAX_QUERY_LENGTH` | `20000`                                      | Characters accepted, so the body limit is not what rejects a query |

Every `ADHOC_*` variable above can be set by an administrator in the interface, and
**setting one here pins it**: the control renders disabled and names the variable. That is why the Compose file passes them through blank rather than defaulting them
— baking `:-false` in would have pinned all six on every deployment and left a settings page
that accepted edits and changed nothing. The same three-layer rule as the delivery
settings — [Configuring it without a shell](#configuring-it-without-a-shell).

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
- **Destroying evidence is now recorded, not just restricted.** See the audit trail above:
  every action that removes or redirects a persisted record — a finding, a device, a
  suppression rule, the delivery settings, the legacy packet log — appends an append-only
  entry naming who did it, in the same transaction that does it. Packet capture control
  (`/clear`, `/stop`) is a deliberate exception; see "What this does not yet cover" above.
- **Destroying evidence requires ADMIN.** Two routes let any authenticated account remove or
  alter the record of what happened on the network: `DELETE /api/alerts/:id` deleted findings
  one at a time while the bulk `DELETE /api/alerts` beside it required an administrator — so
  the gate on the bulk route bought nothing — and the legacy `logs` CRUD let a signed-in user
  add a fabricated traffic record, rewrite one, or delete one. Both predate this port's
  authorisation work rather than being introduced by it; they surfaced when the route-guard
  check was extended to cover every router instead of the three it had grown to cover. Reading
  the log stays open to any account, which is the point of keeping it.

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
  different row. The path id won, and then the whole endpoint was removed — see the legacy
  packet log above.
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

Taken from the running application, against a small set of representative findings —
the addresses and hostnames are from the documentation ranges, not a real network. They
are also the illustrations in the [user guide](user-guide/index.html), which covers the
same screens from an operator's side rather than a developer's: what each one is telling
you, and which actions each role is allowed to take.

They are captured by a script rather than by hand, which is why: they had gone stale
twice — once wholesale after the MUI rewrite, and again when the delivery settings moved
under the administration gear. A screenshot of a screen that no longer exists is the one
a reader trusts over the application in front of them.

```bash
npm run dev                                   # in another terminal
npm i -D playwright && npx playwright install chromium   # once
SHOT_EMAIL=you@example.com SHOT_PASSWORD='...' node scripts/capture-screenshots.mjs
node scripts/capture-screenshots.mjs delivery administration-settings   # or just these
node scripts/capture-screenshots.mjs language-menu dashboard-de alerts-fa  # the language set
```

`playwright` is deliberately **not** a dependency of this project: it is a browser
download for a task nobody runs in CI, and adding it would put it in every install and
every `npm audit`. Install it when you need to recapture. Credentials come from the
environment rather than arguments so a shell history does not keep them, and each shot
signs in fresh — a shot that depended on the state the last one left behind changes when
the order does, and the failure looks like a UI bug rather than a script bug.

**Dashboard** — what the detectors found, and which hosts keep appearing

![Dashboard](./user-guide/screenshots/dashboard.png)

**Security alerts** — every finding, newest first, with the severity tiles doubling as filters

![Security alerts](./user-guide/screenshots/alerts.png)

**A finding, expanded** — what it means, and the evidence behind it. Evidence never contains
passwords or payloads; the cleartext-credential detector records a username and the secret's
*length*, and the tests assert it.

![A finding, expanded](./user-guide/screenshots/alert-detail.png)

**IP lookup** — reverse DNS, geolocation and WHOIS for any address in a finding, from the
magnifier beside it

![IP information](./user-guide/screenshots/ip-lookup.png)

**Suppression rules** — findings you have declared expected. A matching finding is dropped
before storage, not hidden behind a filter, and every rule carries the reason it exists.

![Suppression rules](./user-guide/screenshots/suppressions.png)

**Alert delivery** — where findings go and whether they are getting there, with the four
limits that decide whether a message is sent stated on the page rather than buried in a
config file

![Alert delivery](./user-guide/screenshots/delivery.png)

**Delivery settings** — changed here and in force immediately, no file to edit and no
restart. A field pinned in the environment renders disabled and names the variable that pins
it (the padlocked chips), because a control that accepts an edit and changes nothing is worse
than no control.

![Delivery settings](./user-guide/screenshots/delivery-settings.png)

**SMTP over OAuth2** — switching authentication to `oauth2` reveals what XOAUTH2 needs and
hides what it does not. The client secret and refresh token are write-only: the API reports
whether each is set and never returns it.

![Delivery settings, OAuth2](./user-guide/screenshots/delivery-settings-oauth2.png)

**Threat intelligence** — off by default, because which feeds to trust is your decision and a
security tool should not start making outbound requests to a list nobody chose. The page says
exactly how to switch it on.

![Threat intelligence](./user-guide/screenshots/threat-intel.png)

**Ad hoc query** — read-only SQL against this system's own database, gated by role and its own
flag, with every query recorded in the audit trail. The columns holding secrets are refused by
the database, not by this page.

![Ad hoc query](./user-guide/screenshots/adhoc-query.png)

**Packet capture** — shown idle on purpose: a live capture on the machine that took these
would put its real addresses and MACs in a public README.

![Packet capture](./user-guide/screenshots/capture.png)

**Sign in** — no account ships with the product. `V5__Remove_seeded_accounts.sql` deletes any
row still carrying the bcrypt hash this repository used to publish, and the first account is
created with `npm run user`.

![Sign in](./user-guide/screenshots/login.png)

**Language** — English, German and Dari, switched from the account menu. Each language names
itself: somebody who has landed in one they cannot read needs the one word they can be relied
on to recognise.

![The account menu, with the Language row](./user-guide/screenshots/language-menu.png)

**German** — roughly 30% longer than English, which is why the tiles and the navigation rail
are laid out to grow rather than to truncate.

![The dashboard in German](./user-guide/screenshots/dashboard-de.png)

**Dari** — the layout mirrors, the columns reverse, and dates switch to the Solar Hijri
calendar with Afghan month names. Addresses stay in the order you would type them: an address
whose octets were reordered to match the paragraph is a different address.

![The alerts list in Dari, right to left](./user-guide/screenshots/alerts-fa.png)

The finding titles in that shot are English because every alert in the installation it was
taken from predates the upgrade. An alert stores *which* finding it is rather than a finished
sentence, and the sentence is written out in the reader's language when it is opened — but
only for findings raised since. Older ones kept the English prose they were stored with, and
there is nothing to translate them from. It resolves as they age out.

Three language shots rather than three sets of fourteen. What a reader needs to see is that
the product speaks their language and what changes when it does; photographing every screen
in every language would treble the set to make the same point, and treble what goes stale.

---

## Troubleshooting

**`Missing required environment variable JWT_SECRET`** — copy `api/.env.example` to
`api/.env` and generate a secret.

**`Invalid email or password` for `admin@example.com`** — that account no longer exists.
`V5__Remove_seeded_accounts.sql` deletes any row still carrying the bcrypt hash this repository
used to ship, because a published hash is a published credential. On an empty `users` table the
first unauthenticated `POST /auth/signup` becomes ADMIN; on a populated one, an existing
administrator creates accounts from the account menu, or run
`npm run user -- set-password --email you@example.com --generate`.

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

Kept here rather than in a tracker so that what shipped, what is next and what was
deliberately refused are all readable from the repository itself.

### Shipped

Newest first. Each of these has a merged pull request with the reasoning in it.

| What | Where |
| --- | --- |
| **Five small gaps, each noticed while doing something else** — the roadmap's own group, cleared. **A sensor can be decommissioned**: since V16 every finding, device and rollup bucket carries the `sensor_id` of the installation that wrote it and nothing could ever remove a set of them, so a sensor retired after a hardware swap stayed in the filter and the inventory for ever — and retention could not reclaim the rows, because the device sweep's cutoff comes from each sensor's own last sighting and the alert sweep *rolls up* as it deletes into a table that is never pruned. One audited transaction over all four tables, refusing this installation with a 409: its detectors are running, so the rows come back, and emptying `known_devices` for a live sensor re-arms new-device detection across the whole segment. **The legacy packet-log writes are gone rather than guarded** — three rounds of improving a guard on endpoints nothing calls, over a table nothing writes, whose rows are a record of what was observed on the network; the `log.*` audit actions stay in `RETIRED_AUDIT_ACTIONS` because the trail cannot be pruned and dropping them would have unlabelled existing rows and taken the values out of the `action` filter. **`capture.start` and `capture.stop`** close the last unrecorded administrator action, including the unattended `CAPTURE_RESUME_ON_START` one — filed under `system:auto-resume`, because the start nobody witnesses is the one the trail most needs — and recorded from the outcome, since two of `startCapture`'s three answers start nothing and `stopCapture` runs happily against an idle service. **"Suppress this" from an alert row** opens the rule form prefilled from the finding, extracted from `SuppressionsPage` rather than copied: kind, source and port, with the target left blank because a scan sweeps targets and pinning the observed one writes a rule that stops covering the same activity tomorrow, and the reason still typed by a person. **And a duplicate-version guard in the migration runner**, over the filenames before the first file is read: two files sharing `V14__` used to be reported as a duplicate key on `schema_migrations` or as a *changed migration*, neither of which mentions that a second file exists | #61 |
| **A restart no longer ends a capture silently** — capture lived entirely in the running process, so a service restart, reboot or redeploy left it off while the screen said *Idle*, which is the same word it uses for a host that has never captured anything. Flow collection comes back from `FLOW_ENABLED`; capture did not, and nothing reported the difference. `capture_session` (V18) records what each sensor was asked to run and whether it was still running when the process last had an opinion, keyed on `(sensor_id, scope)` because one process runs two captures and a row per sensor would have had them overwriting each other — the `known_devices` bug V16 fixed, one table along. The Capture screen now names the interface, who started it and when, with a Resume button that sends the recorded settings rather than the form's; `CAPTURE_RESUME_ON_START` does it automatically and is off by default, because starting a capture with nobody present is a decision about the installation rather than a click in a browser | #59 |
| **The dashboard charts read as one house style** — the chrome from the sibling `professional` project's dashboard, ported into a shared `charts/chrome.ts` rather than an `sx` per chart, because the point is that the two charts match and two charts restyled separately drift on the first change to either: a dashed horizontal-only grid, hairline axes with the tick marks removed (`disableTicks`, not CSS — MUI lays the axis out from `tickSize` and `display: none` left the six pixels reserved), small recessive tick labels and a crosshair on hover. The compact value scale is the part that is not cosmetic: both charts labelled their axes with a bare `toLocaleString()`, which reads the *browser's* locale and not the application's, so a dashboard switched to German drew American labels — invisible to anyone whose browser and interface already agree. `Formatters.compact` shortens through `Intl`, so the suffix belongs to the reader ("2.8M", "2,8 Mio.", "۲٫۸ میلیون"), which a five-year findings count needs because it reaches six figures. Each value axis is sized from the label it will actually carry by asking MUI to measure it, not from a character-count estimate that cannot see a tick the scale invented above the data. **Professional's area-under-line form is deliberately not ported**, for a reason about the data rather than taste: the endpoint emits no row for a period with no findings, so a line or stacked area interpolates through the gap and draws a quiet spell that never happened — columns leave it visible | #60 |
| **A trend chart that stays readable, and says where its detail ends** — the five-year window plotted 1,825 daily bars into about 800px, a solid block with no legible axis at exactly the window where a trend is most likely to be real. The bucket now widens with the window (hourly ≤ 2 days, daily ≤ 90, weekly ≤ a year, monthly beyond), and the API reports which it chose rather than the browser recomputing the rule — the two copies of `days <= 2 ? 'hour' : 'day'` would not have survived four units. Folding rolled-up days into a week or a month means the JavaScript truncation has to agree with Postgres's `date_trunc` exactly, verified two ways: `trend-buckets.test.ts` runs its whole suite on an `Asia/Kabul` session, because `date_trunc` reads the session's zone and a missing UTC pin is invisible under UTC — and the four units were checked case by case against a real server on the same offset. A dashed marker now shows where detail ends and the rollup begins, so a short bar on the left reads as "aggregated" rather than "quiet" — the distinction the rollup exists to preserve, given away by the one chart that shows it | #58 |
| **Four settings-and-audit defects** — the query console could commit a write with no audit row: the "write mode forces auditing" rule was computed from the *settings* while whether a statement can write is the identity of the role the pool authenticated as, and saving settings loosens the first a round trip before it narrows the second. The force now reads the live pool, so the two cannot disagree. The delivery form rewrote `updated_at` and `updated_by` on a save that changed nothing, reattributing the last real change to whoever pressed Save. `ADHOC_*` variables that do not parse are logged at boot, as the delivery ones already were. And `POST /api/adhoc/recheck`'s docblock claimed only the environment could enable the console, which V15 stopped being true | #57 |
| **Vite 8, rolldown and Vitest 4** — the build moves off esbuild/Rollup onto rolldown, which took production builds from ~9s to ~1.2s. Three things broke and none of them were the bundler: jest-dom's type augmentation targets `vitest`'s `Assertion`, which Vitest 4 moved to `@vitest/expect`, silently turning all 346 `toBeInTheDocument` calls into TS2339; vite 8's optional esbuild peer conflicts with the one drizzle-kit pins, so npm nests vite and vitest under the UI workspace and `@testing-library/jest-dom/vitest` — hoisted to the root — can no longer resolve `vitest` at all; and the root scripts named `vite` and `vitest` directly, which stopped resolving for the same reason. `manualChunks`' object form is gone from rolldown, so the framework chunk is now a `codeSplitting` group — not `advancedChunks`, which is the same option deprecated, and which rolldown drops with a warning and nothing else when both are set. Measured to confirm the entry still costs what it did rather than becoming the single blob the comment there warns about | #56 |
| **The interface speaks German and Dari** — layers 2–4 of the internationalisation work: `DirectionProvider` supplies the theme direction, an emotion RTL cache and `dir`/`lang` on the document; `<Identifier>` isolates the addresses, MACs and ports that never pass through a message, including the chart axis where no component can wrap them; `HttpError.of(status, code, params)` renders its own English `message` from the code the response carries, so scripts keep a stable string while a person reads their own language; and `useT()` covers the navigation, the alerts page, the dashboard, the audit trail, sign-in, sign-up and the rest of the page chrome. Dates and numbers followed the application's locale rather than the browser's for the first time, and Afghanistan's Solar Hijri calendar turned out to cost nothing — `fa-AF` already selects it in CLDR, with the Afghan month names rather than the Iranian ones | #55 |
| **Findings stop being English prose** — the first of the four internationalisation layers, and the one that got more expensive every day it waited. Detectors emitted interpolated sentences, so no later translation could recover the structure that had been interpolated away: once `445` is inside a sentence nothing tells it from a byte count. A finding now stores a message key and its parameters, rendered in the reader's language at display time; English, German and Dari catalogues ship, ICU MessageFormat handles the plural categories the three do not share, and interpolated identifiers are bidi-isolated centrally so an address cannot render with its octets reordered inside a right-to-left sentence | #55 |
| **`sensor_id` on findings, devices and rollups** — two installations sharing one database wrote into each other's rows: `alerts.dedup_key` was globally unique although the key is derived from what was observed, and `known_devices` was keyed on the MAC alone, so a device one sensor had learned silently switched off new-device detection on every other | #54 |
| **Both query-console roles revoked, not just the read one** — `revokeAdhocLogin` took `adhocRole()`'s `read` default, so every path that switched the console off left `nm_adhocrw_<database>` holding `LOGIN`, the last write-mode password and V12's DML on the operational tables; no supported operator action reached it. Both modes now revoke wherever the console goes off, `startAdhoc` strips the mode it is not using, and the statement is `NOLOGIN PASSWORD NULL` so the credential is destroyed rather than disabled | #53 |
| **Role management in the interface** — role was settable only in `psql`; now Administration settings → Users and roles, audited, refusing to demote the last administrator (in a locked transaction, because two administrators demoting each other loses a count-then-update race) or to demote yourself | #53 |
| **Delivery settings moved under the gear, and unpinned** — one place to edit rather than two, and the fix for a bug that made the whole feature inert: Compose passed every delivery variable with its default baked in, so all 16 fields reported themselves as pinned by the file an administrator was told not to edit | #53 |
| **Administration settings, and the query console among them** — an admin-only settings gear holding a diagnostics panel that distinguishes the console's three off-states, and a settings form that switches it on, sets its password and tunes its limits without a restart; the same three-layer resolution as the delivery settings, with the credential redacted in the resolver so no endpoint can leak it by forgetting | #53 |
| **A draggable dialog, used everywhere** — `AppDialog`, ported from the sibling `professional` project, so a tool can sit over the page whose numbers it is being reconciled with | #53 |
| **SMTP that modern mailboxes accept** — XOAUTH2 with a refresh token, so a Microsoft 365 or Google mailbox works without basic SMTP AUTH; a half-filled setup names its missing variables instead of opening a socket, and the same `535` is explained differently depending on which auth method is in force | #53 |
| **Postgres in CI** — the SQL-level claims stop being probes run by hand: a service container, a harness that refuses any database not named `_test`, and standing tests for the four retention bugs review caught, each verified by reintroducing the bug | #51 |
| **Grouped sidebar navigation** — eight tabs in one header strip became a bordered panel with named sections, ported whole from the PRO 2.0 sidebar in the sibling `professional` project; collapses to a rail, remembers that, and spends no vertical room, which is the axis the tables need | #50 |
| **Audit trail** — who deleted, changed or redirected something; append-only, enforced by a trigger, written in the same transaction as the act it records | #49 |
| **Route-level auth tests** — every authenticated route swept over real HTTP with seven credentials; found `DELETE /api/alerts/:id` and the legacy log writes ungated, and a CI glob that had been running 456 of 496 tests | #48 |
| **Retention with daily rollup** — detail expires, the shape does not: expiring days are aggregated into `alert_rollup_daily` in the same transaction that deletes them | #45 |
| **`npm audit` clean** — a scoped override forcing `@esbuild-kit/core-utils` onto esbuild ^0.25, closing the last four moderates | #44 |
| **Delivery settings in the UI** — three layers per field (environment → stored row → default) with the *environment winning*, and provenance in the API contract so a pinned field renders disabled | #39 |
| **Teams Adaptive Card** — the retired Office 365 connector schema replaced; `*.logic.azure.com` detected as Power Automate Workflows | #37 |
| **Dependabot security updates** — they were switched *off* on this repository while alerts were on, so two high-severity advisories could never produce a PR | #31, #35 |
| **Suppression rules** — a conjunction of kind, source/target CIDR and port, with a mandatory reason and optional expiry, evaluated once so storage, webhook, email and SIEM all agree | #30 |
| **Signup escalation closed, syslog/CEF export, Delivery page, capture control gated, seeded admin removed** | #14 |

### Next, in order

1. **Finish internationalisation.** No engineering left — what remains cannot be done by
   whoever writes the code:
   - **Native review of the German and Dari catalogues.** All ~700 strings are
     machine-drafted. Dari most urgently, since nobody on the team reads it. This is the
     one that should block calling the feature finished: every guard in the repository
     checks that a translation *exists* and interpolates correctly, and none of them can
     tell whether it is any good.
   - **A Perso-Arabic webfont**, if the system faces the theme now names turn out to look
     wrong to somebody who reads Dari. Bundling Vazirmatn through `@fontsource` is the
     answer if they do; that is a judgement made by looking, not by measuring.
   - **The user guide** is still English in sixteen of its seventeen topics.

   Two items that stood here are done and were removed rather than left to be re-read: the
   administration panels' long-form prose was converted in #55, and `DataGrid`'s numeric
   cell already formats through the application locale — the conflict described with the
   query console's grid does not exist, because that page renders its own cells.
2. **The flow collector has no interface at all**, and it is the last subsystem that is
   still environment-only. Two halves, worth doing in this order because only the second
   one carries any risk.

   **A read-only status panel**, which is the half that is purely missing information.
   `GET /api/flow/status` already returns everything an operator needs — per exporter: the
   version word, whether it is a protocol we implement, datagrams, records,
   `pendingTemplates`, malformed count and last-seen, sorted busiest-first, plus totals,
   `templatesCached` and `ignored`. **Nothing in `network-monitoring-ui/src` calls it.** The
   route's own docblock states the case: *"'Configured but receiving nothing' and 'receiving
   but every record is awaiting a template' are the two failure modes during setup, and they
   are indistinguishable from a single total"* — and the product currently shows neither.
   `pendingTemplates` is the sharp one: a v9 or IPFIX exporter that sends data records
   before its templates is counted in `datagrams`, decodes nothing, and looks identical to a
   working device.

   One detail the panel has to get right: `getStatus()` reports `enabled` (what
   `FLOW_ENABLED` says) beside `listening` (whether the socket is open). They differ exactly
   when the bind failed — the port is taken, or the address is not on this host — which is
   the second most likely setup failure, and a single on/off would hide it.

   **Three-layer settings, as delivery (#39) and the query console (#53) both got**, for the
   reason both of those cited: a restart on a monitoring server drops a live capture.
   `FLOW_ENABLED`, `FLOW_PORT`, `FLOW_BIND_ADDRESS` and `FLOW_EXPORTERS` are read once at
   boot and cannot be changed without editing a file and restarting. The shape is established
   — a settings table, a resolver with environment → stored row → default, a seed that copies
   the environment in so an existing install does not see every field pinned, an admin panel,
   and pinned fields disabled with the variable named.

   Two things make flow harder than either precedent, and both should be settled before it
   is started:

   - **The port and bind address cannot change live.** They are bound by a `dgram` socket at
     boot, so a save has to close and reopen it — the same `stopAdhoc()`/`startAdhoc()` dance
     `PUT /api/adhoc/settings` does, with the same ordering hazards that took three review
     rounds to get right there. `FLOW_ENABLED` and `FLOW_EXPORTERS` are easier: one is a
     socket open or close, the other a filter test per datagram.
   - **Under Compose the published UDP port is a separate file.** `docker-compose.flow.yml`
     publishes it, and `docker-compose.yml:156` explains why it is not in the main file —
     putting it there opened `2055/udp` on every deployment. So enabling flow from a browser
     on a Compose install would report success while no traffic could reach the container.
     The panel has to say that, or the setting is a trap built on top of a comment explaining
     the trap.

### Internationalisation — English, German and Dari

**Shipped in #55.** Kept at this length rather than collapsed into the table above,
because the reasoning is what a fifth language will need: which layers were cheap now and
expensive later, why **Dari being right-to-left** made this an architectural change rather
than a string-extraction exercise, and which decisions were made on purpose.

It also finally gives `users.lang_code` a meaning. The column has existed since V1, is
`NOT NULL`, defaults to `en`, is written by sign-up and the user CLI, and is returned in
every user DTO — and until Layer 1 nothing read it. It is now the second of the three
sources `LocaleContext` consults, behind an explicit choice stored in the browser and ahead
of `navigator.languages`. It also rides on the login response, not only on `GET /auth/me`,
so the interface switches language on the sign-in itself rather than on the next reload.

**Library: ICU MessageFormat**, via `intl-messageformat` directly rather than `react-intl`.
The choice of ICU is not a preference about syntax — the interface counts things constantly
("3 findings", "1 device"), and English, German and Dari do not agree on plural categories,
so a hand-rolled `count === 1 ? … : …` is wrong in Dari on day one. Taking the formatter
without the React binding is what avoids a *second* ICU implementation: the server needs the
same renderer for the email body and the syslog export, so the renderer is written once in
`api/src/i18n/` and mirrored into the UI by `api/scripts/copy-catalogs.mjs` — the same shape
as `copy-migrations.mjs`, with `npm run i18n:check` in CI so a stale copy fails the build
rather than drifting. The direction is API → UI and never back: finding messages are
authored next to the detectors that emit them, which is the only place their parameters are
known.

#### The four layers, hardest first

1. ~~**Findings are stored English prose**~~ — **done**, see V17. Detectors emit a message
   **key plus a params object** and the text is rendered at display time, in the reader's
   language. `Finding.messageKey` names a pair of catalogue entries (`arp_spoofing.sprawl`
   → `.title` and `.description`), derived as a type from the English catalogue so a
   detector naming a variant nobody wrote is a compile error.

   What the rewrite actually cost, since the estimate was the uncertain part: 22 message
   pairs across seven detector files, plus six *fragments* — the DNS tunnelling reasons and
   the threat-intel `via` and attribution clauses — which are prose interpolated into other
   prose and so had to become nested references rather than pre-joined strings. Conditional
   clauses became ICU `select` on an explicit boolean, because ICU cannot branch on a value
   being absent.

   Two rules the catalogue enforces, both invisible until somebody reads the interface in
   Dari. **Identifiers interpolate as strings, counts as numbers.** Not because a bare
   `{port}` localises digits — it does not; `intl-messageformat` renders an unqualified
   argument with `String(value)`, so a number there comes out `445` in every language.
   Localised digits appear only where the pattern asks: `{port, number}`, or a `#` inside a
   `plural`. The rule is that the argument's *type* carries its meaning, so a pattern that
   later gains `, number` in one locale's translation cannot quietly render a port as `۴۴۵`
   and stop it matching what the switch and `tcpdump` print.
   **Interpolated strings are bidi-isolated at render time**, centrally, rather than at each
   of the interpolation sites — see the note on FSI/PDI in `api/src/i18n/render.ts`.

   Historical rows keep their stored prose as a fallback, deliberately: a finding from
   before the change stays readable in the language it was written in rather than becoming a
   missing translation key. `title` and `description` are nullable and never written again;
   a CHECK constraint holds the invariant that a row carries one representation or the
   other, because a row with neither renders a blank line while still counting towards every
   total on the dashboard.

   The German and Dari catalogues are **machine-drafted and need a native speaker's review**
   before they are relied on — Dari the more urgently, since it is the language nobody on
   the team reads.

2. ~~**Right-to-left, and bidi isolation**~~ — **done**. `DirectionProvider` supplies the
   theme's `direction`, an emotion cache carrying `stylis-plugin-rtl`, and `dir`/`lang` on
   the document element. Those are three mechanisms rather than one and none substitutes for
   the others: MUI's `direction` turns MUI's own components round, the emotion plugin flips
   the CSS *this* application writes, and only the document attribute reaches the browser's
   own bidirectional algorithm.

   The part that will actually bite is **bidirectional text isolation**. An IP address, MAC,
   CIDR, port, hostname or SQL fragment placed inside a right-to-left sentence renders in
   the wrong visual order unless it is isolated — `<bdi>`, or U+2068/U+2069 around the
   value. `192.168.1.10` can appear with its octets visually reordered, which for a network
   tool is not a cosmetic bug: the operator reads an address that is not the one in the
   finding.

   This application is *mostly* technical identifiers, so this is the common case rather
   than an edge case. Worth a single shared component — an `<Identifier>` that isolates and
   sets `dir="ltr"` — plus a lint rule, rather than remembering it at each of several
   hundred interpolation sites.

   That is handled in two places, which between them cover every identifier on screen.
   Inside a finding, the *renderer* isolates every interpolated string with U+2068/U+2069 —
   Layer 1 having put all of them behind message parameters, there is exactly one place
   where they become text. Outside one, `<Identifier>` sets `dir="ltr"` and
   `unicode-bidi: isolate`, and is applied to the alert table's source and target columns,
   the packet table (every column of which is an identifier), the IP information dialog and
   the expanded finding's protocol and MAC metrics.

   The awkward case is the **chart axis**, where a tick label is a string handed to
   `@mui/x-charts` rather than an element this application renders, so no component can wrap
   it. `MagnitudeBarChart` takes `labelsAreIdentifiers` and puts the isolation in
   `tickLabelStyle` — SVG text is subject to the bidirectional algorithm exactly as HTML is,
   and the top-sources chart plots IP addresses.

   **Dates and numbers came with it**, and were a bug of their own: every timestamp in the
   interface was a bare `toLocaleString()`, which follows the *browser's* locale rather than
   the application's. `useFormatters()` binds them to the chosen language.

   **The Solar Hijri calendar cost nothing.** `fa-AF` selects it in CLDR on its own, with the
   Afghan month names (سنبله) rather than the Iranian ones (شهریور) — so the calendar
   decision below needed no adapter, no date library, and no per-locale branch: passing the
   application's locale to `Intl` is the whole of it.

   Still open: `DataGrid`'s generic numeric cell still formats through the browser locale.
   It is shared between ordinary tables and the query console's results grid, and those want
   opposite things — grouping and digit shaping are right for a count and wrong for an ID
   column — so it wants a decision rather than a patch.

3. ~~**Server prose the interface displays verbatim**~~ — **done.** `HttpError.of(status,
   code, params)` is now the normal way to raise one, and it renders `message` from the same
   key and params the response carries, so the two cannot drift. The specific messages stayed
   specific: "Set in the environment and cannot be changed here: `ADHOC_MAX_ROWS`" is still
   the useful half of that 409, with the variable names as a parameter rather than summarised
   away.

   The decision held: **a code plus params, translated in the browser**, rather than
   localised on the server from the caller's `lang_code`. Three reasons — the same endpoints
   are read by scripts and by CI, a localised error is one nobody can grep for or search the
   issue tracker with, and it keeps `Accept-Language` out of the API contract. The response
   carries **both**: `message` is always the English rendering, so no existing client changes
   and the server log keeps a stable string, and `code`/`params` ride alongside for the
   interface.

   Two of the 50 sites deliberately did *not* get a code. The zod aggregations share one —
   `error.validation`, whose `detail` carries the joined English through untranslated —
   because their text comes from the schemas themselves, and translating those would mean a
   catalogue entry per field per rule that would go stale silently. The sentence around the
   detail is translated, so the reader still learns what kind of failure it was.

   `describeError` reads the code and falls back to the message. It is a plain module
   function called from about forty `catch` blocks, so the locale is pushed to it by
   `LocaleProvider` rather than threaded through all forty — the same shape as the access
   token that already lives in that file. The cost is that an error already on screen when
   the language is switched keeps its old wording until whatever produced it runs again.

4. **The interface strings** — **substantially done**, and the honest accounting matters
   more here than a tick, because "the interface is translated" is a claim somebody will
   check by opening it.

   **Converted**: the navigation and its search, the account menu, the theme and language
   switches, the alerts page in full (columns, filters, actions, the expanded row), the
   dashboard, the audit trail, sign-in and sign-up, the suppression rules page and its
   dialog, threat intelligence, delivery, the query console's chrome, both capture pages and
   the packet table, and the shared vocabulary — severity names, detector names and their
   one-line explanations — which several screens read.

   The long-form explanatory prose inside the administration panels —
   `QueryConsoleStatus`, `QueryConsoleSettings`, `UserRoles`, and the field-by-field help in
   `DeliverySettingsForm` — was going to be left in English, on the argument that several
   hundred lines of paragraph text whose value is precision would machine-draft into exactly
   the plausible-but-wrong prose this file keeps warning about. It was converted anyway,
   because leaving it produced a worse thing than an imperfect translation: an interface in
   Dari with English paragraphs inside its settings dialogs, which reads as unfinished
   rather than as untranslated. The warning stands and now applies to all ~700 strings
   equally — see the native review at the top of the queue.

   The mechanism itself is complete: `src/i18n/ui/` holds the three catalogues, `useT()` is
   the hook, and `catalog.test.ts` enforces all three — every pattern parses, every key is
   translated into every locale, and **no key exists that the application never asks for**,
   which is what stops the catalogue accumulating strings nobody renders.

   Two things the conversion turned up rather than translated. The sign-up form's language
   field offered English, Dari and **Pashto** — a language this application has no catalogue
   for — and not German, which it ships; choosing Pashto wrote a `lang_code` the interface
   could not honour. It is derived from `LOCALES` now, sharing one endonym map with the
   account menu's switch, so the two can no longer disagree. And `users.lang_code` now rides
   on the login response as well as `GET /auth/me`, so the language follows a sign-in rather
   than waiting for the next reload.

#### What deliberately stays in English

- **The syslog/CEF export.** A SIEM parses it and correlates on it; a localised event name
  breaks every downstream rule. Same for the JSON a webhook receives.
- **`kind` values, `dedup_key`, and audit `action` names.** Identifiers that happen to be
  readable, not text. The audit trail's *labels* are already a lookup map in
  `audit-types.ts` and become keys for free; the stored `action` must not move.
- **Server logs**, which are read with `grep` by whoever is on the host.
- **Outbound notifications are an installation setting, not per-user.** An alert email goes
  to a team address and a webhook has no account at all, so there is no `lang_code` to read.
  One configured language for outbound, alongside the delivery settings. The seam exists —
  `OUTBOUND_LOCALE` in `notify/types.ts`, which `toNotifiable` renders through — and is
  English today, which is what every existing installation already receives; making it a
  stored setting is a change to one value rather than to every channel.
- **The syslog and CEF feeds are English even when outbound is not.** `NotifiableFinding`
  carries both renderings for exactly this reason: "outbound is one configured language" and
  "the machine feed is English" are two different questions, and a channel that read the
  wrong one would break every SIEM rule the day somebody switched the human channels to
  German. Rendered at the boundary rather than inside the channel, so `cef.ts` stays the
  pure formatter its docblock says it is.

#### Decisions to make before starting

- ~~**Calendar for Dari.**~~ **Settled: Solar Hijri**, and it turned out to be free.
  `fa-AF` already selects that calendar in CLDR, with the Afghan month names rather than the
  Iranian ones, so `Intl` does it with no adapter and no date library. Note for whoever adds
  the first date *picker*: there is not one in the interface today — `@mui/x-date-pickers` is
  a dependency that nothing imports — so the adapter question is still open for that, and
  `AdapterDateFnsJalali` is the answer when it arrives.
- ~~**Digit shaping.**~~ **Settled by the type of the parameter.** Eastern Arabic-Indic
  digits (۱۲۳) are idiomatic in Dari prose, so counts interpolate as *numbers* and are shaped.
  IP addresses, ports, MACs and byte counts interpolate as *strings* and are not: shaped
  digits stop being copy-pasteable and stop matching what the switch, the firewall and
  `tcpdump` show. The rule is written down in `api/src/i18n/message.ts` and is the one thing
  most likely to be got wrong when a detector is added.
- ~~**A font with Perso-Arabic coverage**~~ — **partly settled.** The theme's stack now names
  Perso-Arabic *system* faces after the Latin ones (SF Arabic, Geeza Pro, Noto Naskh Arabic,
  Tahoma; Segoe UI was already there and covers Windows). Font fallback is per character, so
  this changes nothing about how English or German renders. System faces rather than a
  bundled webfont because nothing else in this interface is downloaded at runtime, which is
  the right default for a tool expected to run on an isolated network. **Bundling Vazirmatn
  through `@fontsource` is still the better answer if the substituted faces look wrong** —
  that is a judgement somebody who reads Dari has to make by looking at it.
- **German is roughly 30% longer than English.** The dashboard tiles, the navigation rail
  and the settings dialog's two-column grid are the places to check first.

#### The user guide is a content job, not an engineering one

17 topics and ~1,750 lines of prose, all of it English. The guide now has a **Language**
topic covering what switching changes, what it deliberately leaves alone, and why findings
raised before the upgrade stay in English — but the other sixteen topics are still written
in one language only, and that is the bulk of the cost.

The screenshots turned out not to be the problem they looked like. The first estimate here
was three sets of fourteen; what shipped is three shots — the switch, German, and Dari —
because what a reader needs is that the product speaks their language and what changes when
it does, not fourteen photographs making the same point three times. `locale` on a shot in
`scripts/capture-screenshots.mjs` sets `nm.locale` before the page loads, so adding more is
a line each if that judgement turns out to be wrong.

### Known gaps, named rather than left to be discovered

- **The capture session row is keyed to the sensor, not to the process that owns it.** Two
  API processes sharing a `SENSOR_ID` — a rolling redeploy, or a scaled-out API — write to the
  same `capture_session` row per scope. The one that boots second reads the first one's live
  capture as an interruption, and with resuming off stamps it stopped; the live capture then
  runs with nothing open, so the interruption that really ends it has nothing for the next
  boot to find. `reportInterruptedCapture` guards on `this.capturing`, which closes the
  single-process window where the API is already serving requests during boot, but cannot see
  another process at all. The fix is an owner column — a process identity written with the
  row and compared on read — which is a schema change and its own piece of work.
- **`SlidingWindow` does not slide.** It sets `expiresAt` once when a bucket is created and
  discards the whole bucket when that passes, which is a *tumbling* window. An attacker who
  probes just under the threshold, waits for the boundary and repeats is never detected, and
  nothing about the failure is visible.
- **`isStructuralAddress` tests the multicast bit but not the locally-administered bit**, so
  every modern phone using MAC-address randomisation raises a new-device alert.
- **Delivery settings have no history** beyond `updated_by` and the audit entry naming which
  fields changed. Reconstructing a past configuration is not possible.
- **A retired sensor's newest devices are never reclaimed.** Device staleness is measured from
  each sensor's own `max(last_seen)`, so a sensor that stops writing stops advancing its own
  cutoff and keeps everything inside the last window. That is the cost of not letting one
  sensor's clock sweep another's devices; there is no way to decommission a sensor yet, so the
  rows stay for the life of the installation unless somebody deletes them by hand.
- **This has never run against real hostile traffic for a sustained period.** Running it on
  one real network for a month and writing down exactly what it said is worth more than the
  next three features on this list.

### Later

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
- Alert enrichment at write time; server-side pagination and CSV export.
- pcap export, so a finding can be opened in Wireshark for deeper analysis.
- Traffic visualisation over time: top talkers, protocol mix, alerts per hour.

**Deployment**

- Document the SPAN port / network TAP setup. Running on a workstation only sees that
  workstation's own traffic plus broadcasts, which is the most common reason the tool appears
  to find nothing.

### Deliberately out of scope

Listed so the same proposals are not re-litigated: case management and ticketing, additional
RBAC roles beyond USER and ADMIN, PCAP retention and indexing, a rule language, and IDS
signature compatibility.

## Contributing

Issues and pull requests are welcome. New to this codebase? **[CONTRIBUTING.md](CONTRIBUTING.md)**
is the "where do I start" guide — a reading order, the mental model behind the two detection
pipelines, and where to begin for the most common changes (a new detector, a new endpoint, a
migration). Please run `npm run ci && npm run build` before opening a PR.

## License

MIT — see `LICENSE`.
