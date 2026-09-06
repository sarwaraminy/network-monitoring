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

Every setting below can be changed on the **Delivery** page by an administrator, and
takes effect immediately — no file to edit, no restart. That matters because the person
configuring this is usually an IT admin rather than the developer, and asking them to
shell into the host to add a second recipient makes every tuning change an outage.

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
3. **Your company mailbox with an ordinary password** — this usually fails. Microsoft 365 and
   Google disable basic SMTP AUTH by default on modern tenants, so a *correct* password is
   rejected exactly like a wrong one. When the server returns `535` or nodemailer reports
   `EAUTH`, the delivery result says so rather than passing the raw SMTP string through, because
   "authentication unsuccessful" sends people to check a password that was never the problem.

OAuth2 / XOAUTH2 is not implemented. If your tenant requires it, use a relay.

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
months and 3 years for exactly that reason: the reachable window has to be able to reach past
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

Buckets are UTC days, explicitly. `date_trunc('day', ts)` uses the session's `TimeZone`, which
would make the same data roll up differently on two servers — on a machine set to `Asia/Kabul`
a finding at 22:30Z lands in the *next* day. Both the bucket expression and the range bounds
say `AT TIME ZONE 'UTC'`.

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
  output is evidence, both are a different kind of act from acknowledging a finding. All four
  are ADMIN now; reading stays open, which is the point of keeping the table.
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

### Security alerts — `/api/alerts`

| Method   | Path                    | Purpose                                                |
| -------- | ----------------------- | ------------------------------------------------------ |
| `GET`    | `/`                     | Findings, most urgent first. Filter by `severity`, `kind`, `since` (ISO or `24h`), `acknowledged` |
| `GET`    | `/summary`              | Counts by severity and detector, for the dashboard tiles |
| `GET`    | `/dashboard`            | Summary plus trend buckets and top sources (`days`, `bucket`) |
| `GET`    | `/devices`              | MAC addresses seen on the network                       |
| `POST`   | `/:id/acknowledge`      | Mark a finding as handled                               |
| `POST`   | `/:id/unacknowledge`    | Reopen it                                               |
| `DELETE` | `/:id`                  | Delete one finding (ADMIN)                              |
| `DELETE` | `/`                     | Clear all findings (ADMIN)                              |
| `DELETE` | `/devices/:mac`         | Forget a device, so it is reported as new again (ADMIN) |

### Audit trail — `/api/audit`

Append-only and ADMIN-only. There is no write endpoint, and there should never be one: the
table refuses `UPDATE`, `DELETE` and `TRUNCATE` at the database level.

| Method | Path       | Purpose                                                          |
| ------ | ---------- | ---------------------------------------------------------------- |
| `GET`  | `/`        | Entries, newest first. `action` filters, `before` pages (keyset on `id`), `limit` up to 200 |
| `GET`  | `/actions` | The action vocabulary and its labels, so the filter cannot drift from the server |

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

The per-packet anomaly log that `alerts` supersedes. Nothing writes to it any more; the
endpoints remain so existing history stays reachable.

| Method   | Path            | Purpose                                |
| -------- | --------------- | -------------------------------------- |
| `GET`    | `/logs`         | All historical records                 |
| `POST`   | `/logs`         | Same as `GET` (kept for compatibility) |
| `POST`   | `/log/add`      | Create a record (ADMIN)                |
| `PUT`    | `/log/:id`      | Update a record (ADMIN)                |
| `DELETE` | `/log/:id`      | Delete a record (ADMIN)                |

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

1. **SMTP that modern mailboxes accept** ([#27](https://github.com/sarwaraminy/network-monitoring/issues/27), ~1 wk).
   Microsoft 365 and Google both disable basic SMTP auth by default, so email delivery does
   not work with the two most common providers. An internal relay already works with no
   credentials and a 535 is already legible; what is missing is OAuth2/XOAUTH2.
2. **`sensor_id` on alerts** (~3–4 d). Two sensors sharing one database currently merge
   each other's findings. Cheap now and expensive once anyone has data.
3. **Vite step 2** — vite 8 + `@vitejs/plugin-react` 6 + vitest 4. Needs a local jest-dom
   type shim (jest-dom augments `vitest`'s `Assertion`; Vitest 4 moved that to
   `@vitest/expect`'s `Matchers<T>`) and a fix for `vitest` no longer hoisting to the root
   `.bin`.
4. **Small, and each independently useful:**
   - Delete the legacy packet-log write endpoints rather than guarding them. Nothing calls
     `POST /api/log/add`, `PUT /api/log/:id` or `DELETE /api/log/:id`, and nothing writes
     the table; removing them removes the surface instead of protecting it. The `GET` stays,
     because the history is why the table is kept.
   - A coarser bucket for multi-year trend windows, which currently plot 1,095 daily bars.
   - A marker on the trend chart for where the retention boundary falls, so a shorter bar
     reads as "rolled up" rather than "quiet".
   - "Suppress this" from an alert row — left out of the suppression PR to keep it
     reviewable, and the obvious next touch on that page.

### Known gaps, named rather than left to be discovered

- **`SlidingWindow` does not slide.** It sets `expiresAt` once when a bucket is created and
  discards the whole bucket when that passes, which is a *tumbling* window. An attacker who
  probes just under the threshold, waits for the boundary and repeats is never detected, and
  nothing about the failure is visible.
- **`isStructuralAddress` tests the multicast bit but not the locally-administered bit**, so
  every modern phone using MAC-address randomisation raises a new-device alert.
- **Delivery settings have no history** beyond `updated_by` and the audit entry naming which
  fields changed. Reconstructing a past configuration is not possible.
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
