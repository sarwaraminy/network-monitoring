<!--
Draft body for the modernize/node-typescript-stack PR.

Not opened automatically: the gh CLI on this machine is authenticated as
`sarwaraniny`, which has read-only access to `sarwaraminy/network-monitoring`.
Either paste this into the web form, or run `gh auth switch --user sarwaraminy`
and then:

  gh pr create --base main --head modernize/node-typescript-stack \
    --title "Replace Spring Boot/Java + CRA with a Node/TypeScript stack, and rebuild detection" \
    --body-file .github/PULL_REQUEST_BODY.md

Delete this file once the PR is open.
-->

Ports the application off Java and Create React App, rebuilds the detection engine, and adds the tooling a real deployment needs.

Large diff (187 files), but it is a replacement rather than an edit: the Java tree and the CRA tree are deleted, and `api/` and `network-monitoring-ui/` are rewritten in TypeScript. The API surface is unchanged apart from additions, and **the existing PostgreSQL database needs no changes** — the Flyway migrations are carried over and their history is adopted on first boot.

## Stack

| | Before | After |
| --- | --- | --- |
| Backend | Spring Boot 3.3 / Java 17 | Node 22 · Express · TypeScript · Drizzle |
| Capture | Pcap4J | Npcap/libpcap via koffi FFI — **no C++ toolchain** |
| Frontend | CRA · JavaScript · Bootstrap | Vite · React 19 · TypeScript · MUI 7 · Material React Table |
| Data fetching | `useEffect` + `setInterval` | TanStack Query |
| Tooling | none | Biome · Vitest · GitHub Actions · Docker · Dependabot |

## Detection was rewritten, not ported

This is the substantive change. The original rules asked "is this packet anomalous?" and flagged frames under 64 bytes and SYN-without-ACK — every bare TCP ACK and every new connection.

Measured against the real database before touching it: **100% of stored alerts were false positives** (traffic to Microsoft, Bing, Akamai, OpenDNS), and the ARP spoofing feature the project led with had never fired correctly, because `isTrustedMapping()` returned true on a MAC *mismatch* and `isArpSpoofed()` then negated it.

Replaced with seven stateful, windowed detectors emitting deduplicated alerts that carry a severity, an occurrence count and structured evidence: ARP spoofing (bindings learned at runtime, no config), cleartext credentials across five protocols, port scan, host sweep, SYN flood, DNS tunnelling, new-device.

Passwords are never recorded — only the username and the secret's length — and the tests assert that, including the base64 form.

## Bugs found and fixed

- ARP spoof detection was logically inverted (above).
- A failed capture start returned `200`, leaving the UI showing "capturing" with nothing arriving.
- The IP-filtered capture wrote anomaly logs without checking for an IP layer, against `NOT NULL` columns, so ARP frames could throw.
- Ethernet padding was computed from fixed 14+20+20 offsets regardless of the actual headers.
- `PUT /api/log/:id` trusted the body's id and could overwrite a different row.
- Loopback capture silently produced nothing: Npcap reports link type `NULL`, and anything non-Ethernet was skipped.
- libpcap never loaded on Debian/Ubuntu — their runtime package ships `libpcap.so.0.8`, not `libpcap.so.1`. This affected the container and CI.
- `POST /start` from the browser returned `400`: axios serialises a `null` body to the string `"null"`, which `express.json()` rejects in strict mode. Only reproducible through the UI, not `curl`.
- Shutdown closed the database pool before the alert flush that needs it, silently losing findings.
- The login rate limiter counted *successful* logins, so ten normal sign-ins locked you out.

## Security

- The JWT no longer carries the user's plaintext password.
- The signing key comes from `JWT_SECRET`, not a string literal in two files.
- Tokens are actually verified on protected routes — previously the server decoded one to read an email and never checked signature or expiry.
- Capture endpoints require auth; they were open, and they start promiscuous capture on the host.
- `GET /auth/users` is ADMIN-only and no longer returns bcrypt hashes.
- The BPF filter input is validated before interpolation.
- The frontend no longer stores the password, nor decides "logged in" by decrypting a localStorage string.
- Alerts never contain packet payloads, and `REDACT_PACKET_PAYLOAD` blanks them in the live view too — relevant wherever wiretap statutes or GDPR apply.

## Verifying this

```bash
npm install
cp api/.env.example api/.env   # set JWT_SECRET and DATABASE_URL
npm run migrate
npm run user -- set-password --email admin@example.com --generate
npm run dev
```

The seeded accounts' bcrypt hashes have no known plaintext, which is why the user CLI exists — without it a fresh install cannot log in.

```bash
npm run ci   # Biome, typecheck, 95 tests
```

Neither test suite needs a database, a browser or a running server.

## Caveats worth knowing

- **MUI is on 7, not the latest 9.** Material React Table 3.2.1 declares `@mui/material >=6` but MUI 9 removed `InputProps`, which MRT still passes: on 9 the table's search adornments vanish and `inputprops="[object Object]"` leaks into the DOM. Verified in a browser. MUI 7 is clean.
- **Live capture does not work inside the containers**, by design — the API container has its own network namespace. `docker-compose.capture.yml` enables it on Linux hosts only; on Docker Desktop the engine's VM has different interfaces.
- **Running on a workstation only sees that workstation's traffic plus broadcasts.** Network-wide monitoring needs a SPAN port, a TAP, or running on the gateway. Documented, but it is the most common reason the tool appears to find nothing.
- The screenshots in the README predate this UI.

Merging should clear most of the 115 Dependabot alerts on `main` — they are the old Java and CRA dependencies.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
