# network-monitoring-ui

Frontend for the [Network Monitoring Tool](../README.md). React 18 + TypeScript, built with
Vite, using MUI for components and Material React Table for the two data grids.

> Start here only if you are working on the UI alone. To run the whole stack — API included —
> use `npm run dev` from the repository root.

## Scripts

Run from this directory:

| Command             | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Vite dev server on <http://localhost:5173>           |
| `npm run build`     | Typecheck, then build to `build/`                    |
| `npm run preview`   | Serve the production build locally                   |
| `npm run typecheck` | `tsc -b` with no emit                                |
| `npm test`          | Vitest run (34 tests)                                |
| `npm run test:watch` | Vitest in watch mode                                |

Linting and formatting are handled repo-wide by Biome: `npm run lint` / `npm run lint:fix` from
the repository root. There is no separate ESLint or Prettier config.

The API must be running on port 8080; `vite.config.ts` proxies `/api` and `/auth` to it.

## Environment

Copy `.env.example` to `.env`. Both variables are optional.

| Variable                | Default | Notes                                                            |
| ----------------------- | ------- | ---------------------------------------------------------------- |
| `VITE_API_SERVER`       | empty   | Empty uses the dev proxy. Set to the API origin for a real build. |
| `VITE_POLL_INTERVAL_MS` | `1000`  | Packet list refresh interval while a capture runs.                |

Vite only exposes variables prefixed `VITE_`; the old `REACT_APP_*` names no longer work.

## Layout

```
src/
  api/            Axios instance (attaches the bearer token, handles 401) and typed
                  wrappers per endpoint group
  auth/           LoginPage, SignUpPage, PrivateRoute
  components/     AppLayout (AppBar + drawer), AlertSummaryTiles, SeverityChip,
                  CaptureToolbar, PacketTable, IpInfoDialog, HexDump
  contexts/       AuthContext — the single source of truth for the session
  hooks/          usePacketCapture (shared by both capture pages), useIpInfo
  pages/          AlertsPage (the landing page), PacketCapture, PacketCaptureWithIP
  types/          Mirrors the API's DTOs
  theme.ts        MUI theme; Material React Table inherits it
```

## Notes for contributors

- **Both capture pages share `usePacketCapture` and `CaptureToolbar`.** They differ only in the
  `scope` passed in (`'interface'` vs `'filtered-ip'`) and whether the IP filter field shows.
  Fix a capture bug once, in the hook.
- **Auth state is never derived from localStorage contents.** `AuthContext` holds the token and
  the user; `isAuthenticated` means the server accepted the token via `GET /auth/me`. Do not
  reintroduce client-side "am I logged in" checks.
- **Hex streams go in the detail panel, not a cell.** A frame at the default 65 KB snapshot
  length is a ~196 000 character string; `HexDump` renders it as an offset/hex/ASCII dump on
  demand.
- **Errors belong in an `Alert`,** not `console.error`. `describeError` in `api/client.ts`
  unwraps the server's `{ message }`.
- **An alert has to explain itself.** Severity and a title are not enough — the expanded row
  carries a "what this means" paragraph plus the evidence, because the person reading it may
  not know what ARP spoofing is. Any new detector needs a label and description in
  `components/SeverityChip.tsx`.
- **Pass `undefined`, not `null`, as an axios request body.** Axios serialises `null` to the
  literal string `"null"`, which `express.json()` rejects in strict mode — a 400 that only
  reproduces through the browser.
- **Tests live beside what they cover** and run in jsdom against MSW, so no server is needed:
  `src/auth/auth.test.tsx`, `src/pages/AlertsPage.test.tsx`, `src/pages/PacketCapture.test.tsx`,
  `src/charts/palette.test.ts`. Helpers are in `src/test/` — use `renderApp` for a plain
  component and `renderRoutes` for anything that redirects.
- **A component containing `<Navigate>` needs a real route tree.** Mounted bare it navigates,
  re-renders and navigates again forever, hanging the test file with no output. That is what
  `renderRoutes` exists for.
- **Run Vitest unpiped.** Piping through `tail` buffers all output, so a hang prints nothing
  and looks like an unrelated failure.
