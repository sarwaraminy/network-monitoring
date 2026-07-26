# network-monitoring-api

Backend for the [Network Monitoring Tool](../README.md). Node + Express + TypeScript, with
Drizzle ORM over PostgreSQL and live packet capture by calling Npcap/libpcap directly through
[koffi](https://koffi.dev/) FFI — no compiled addon, so no C++ toolchain.

Replaces the previous Spring Boot 3.3 / Java 17 service. Endpoint paths and response shapes are
unchanged; see [Migration notes](../README.md#migration-notes) in the root README for the
deliberate differences.

> To run the whole stack, use `npm run dev` from the repository root.

## Scripts

Run from this directory:

| Command             | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | `tsx watch` on <http://localhost:8080>                     |
| `npm run build`     | Compile to `dist/` and copy the SQL migrations alongside    |
| `npm start`         | Run the compiled server from `dist/`                       |
| `npm test`          | Packet decoder + anomaly detector tests (`node:test`)      |
| `npm run migrate`   | Apply pending migrations and exit                          |
| `npm run typecheck` | `tsc --noEmit`                                             |
| `npm run user`      | User administration: list / create / set-password / delete   |

Npcap (Windows) or libpcap (Linux/macOS) must be installed for capture. Depending on how it was
installed, capture may require elevated privileges: run as Administrator (Windows) or with
`sudo` (Linux).

## Configuration

Copy `.env.example` to `.env`. `JWT_SECRET` is required and the server refuses to start without
it. See the [environment variable table](../README.md#apienv) in the root README.

`config/env.ts` resolves `api/.env` relative to its own location, so the server behaves
identically whether started from here or from the repository root.

## Architecture

```
src/
  index.ts              Boot: migrate, listen, graceful shutdown
  app.ts                Express app — CORS, JSON, routers, error handling
  config/env.ts         Parses and validates the environment once, at import
  constants.ts          Values shared across layers (kept free of DB imports)
  db/
    schema.ts           Drizzle definitions for `users` and `logs`
    index.ts            pg Pool + Drizzle instance
    migrate.ts          Flyway-compatible SQL runner (adopts flyway_schema_history)
    migrations/         V<n>__<name>.sql, carried over unchanged
  logger.ts             pino instance; componentLogger() tags a subsystem
  cli/manage-user.ts    User administration, so a deployment is never locked out
  middleware/
    auth.ts             requireAuth (verifies the JWT) and requireRole
    rate-limit.ts       Per-endpoint-group limiters; auth counts failures only
    error-handler.ts    HttpError, asyncHandler, the error middleware
  packet/               The Pcap4J replacement — no Express or DB dependencies
    libpcap.ts          Npcap/libpcap over koffi FFI: device list, handle, drain
    decode.ts           Ethernet, loopback, LLC/SNAP, 802.1Q, IPv4, IPv6, ARP, TCP, UDP
    names.ts            EtherType / IP protocol / LLC SAP name tables
    addresses.ts        MAC, IPv4, IPv6 (RFC 5952) and hex formatting
    mapping.ts          DecodedPacket -> PacketDTO
    detect/
      types.ts          Finding, Severity, SlidingWindow, BoundedMap
      arp-spoof.ts      Learned IP-to-MAC bindings; MITM detection
      scan.ts           Port scan, host sweep, SYN flood
      plaintext-credentials.ts  Unencrypted logins across five protocols
      dns-tunneling.ts  Encoded-looking query names
      new-device.ts     Unrecognised MAC addresses
      index.ts          DetectionEngine
      test-frames.ts    Frame builders shared by the tests
      detect.test.ts    Attack simulations and false-positive guards
    decode.test.ts      Decoder tests; no database, no Npcap needed
    libpcap.test.ts     FFI integration tests; skip when no pcap library
  networkservices/      Reverse DNS, WHOIS (TCP 43), ip-api.com geolocation
  routes/               auth, logs, packets (one factory, mounted twice)
  services/
    alert.service.ts    Aggregates findings into deduplicated alerts; batched writes
    device.service.ts   Persists known MAC addresses across restarts
    packet-capture.service.ts  Capture lifecycle, poll loop, per-session detection state
    user.service.ts / log.service.ts / jwt.service.ts
  types/
    dto.ts              Wire shapes; mirrored by the UI's src/types
```

## Notes for contributors

- **`decode.ts` is pure.** It takes a `Buffer` and returns plain data — no Express, no database,
  no FFI. That is what makes it testable, so keep it that way.
- **Every decoder read is bounds-checked.** Truncated frames are normal whenever the snapshot
  length is below the MTU; a decoder must return `null` for a layer rather than throw.
- **The pcap library is loaded lazily** inside `libpcap.ts`, and a failure to load surfaces as
  `PcapUnavailableError` → HTTP 503. Every non-capture endpoint must keep working on a machine
  with no Npcap, and the process must never fail to boot because of it.
- **The capture handle is non-blocking and polled.** `drain()` must return promptly and never
  wait on the network; the service calls it on a timer. Do not add a blocking `pcap_loop`.
- **Copy frame bytes before keeping them.** pcap reuses its own buffer for every packet;
  `readBytes` returns a copy for exactly this reason.
- **The two capture services are one class, instantiated twice** in
  `services/packet-capture.registry.ts`. The Java original was two near-identical files that had
  already drifted apart; do not split them again.
- **Named numbers render as `<value> (<name>)`** — for example `0x0800 (IPv4)`. This is Pcap4J's
  exact format, and rows written by the old app share the `logs.ipversion` column with new ones,
  so the spacing matters. `decode.test.ts` pins it.
- **The packet buffer is bounded** by `CAPTURE_BUFFER_SIZE`. Anything that accumulates per
  packet needs a ceiling — detector windows use `SlidingWindow` and `BoundedMap` for this.
- **A new detector is one file in `detect/`** implementing `Detector`, registered in
  `detect/index.ts`. It must be stateful-but-bounded, judge patterns rather than single packets,
  and return findings with a stable `dedupKey` so repeats aggregate.
- **Never put a secret in `evidence`.** It is persisted and rendered. Record that a credential
  was present and its length; never the credential. `detect.test.ts` asserts this for every
  protocol, including the base64 form.
- **Every new detector needs a false-positive test.** The rules these replaced flagged 100% of
  ordinary traffic; the `quiet on normal traffic` suite exists to stop that recurring.
- **Log through `componentLogger`, not `console`.** Biome fails the build on `console.log`
  outside tests and CLI entry points. Pass structured fields — `log.warn({ mac, err }, 'msg')` —
  rather than interpolating into the message, so the output is queryable.
- **Shutdown order is load-bearing.** `stopAllCaptures()` flushes buffered findings and needs the
  connection pool, so it must complete before `closeDb()`. See `index.ts`.
