import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { FLOW_OFF, FLOW_STATUS } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import type { FlowStatus } from '../types';
import FlowPage from './FlowPage';

/**
 * Flow collection, from the operator's side.
 *
 * The endpoint has returned everything on this page since the collector was
 * written and nothing called it, so setting flow up meant reading the API's log.
 * What the cases below are about is the distinctions that exist precisely because
 * a total cannot make them — each one is a state that, rendered as a single
 * number or a single on/off, is indistinguishable from a different problem with a
 * different fix.
 */

/**
 * Replaces the status for one test.
 *
 * Typed as `FlowStatus` rather than as the fixture's own shape, so a case that
 * drifts from the API contract fails here instead of rendering a panel the server
 * could never produce.
 *
 * `datagramsUnderAllowlist` is forced to equal `datagrams` here, because that is
 * the collector's own invariant on a binding nobody has edited the allowlist on,
 * and every case using this helper is describing one. Pinned rather than left to
 * the caller: a case that overrode `datagrams` and inherited the fixture's span
 * would silently lose the "everything was refused" branch, which is the exact
 * failure this pair of fields exists to prevent. The cases that need the two to
 * differ — the state after an allowlist edit — build their own handler and say so.
 */
const status = (body: FlowStatus) =>
  server.use(
    http.get('/api/flow/status', () =>
      HttpResponse.json({ ...body, datagramsUnderAllowlist: body.datagrams }),
    ),
  );

describe('FlowPage', () => {
  it('says what it is bound to, not just that it is on', async () => {
    // The address and port the socket actually reports, because "enabled" and
    // "bound to 0.0.0.0:2055" are different claims and only the second one means
    // traffic can arrive.
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/listening on 0\.0\.0\.0:2055/i)).toBeInTheDocument();
  });

  it('reports a failed bind as its own state, not as off', async () => {
    /*
     * The distinction the whole header exists for. `enabled` says what
     * FLOW_ENABLED says; `listening` says whether the socket opened. They differ
     * exactly when the bind failed — the port is taken, or the address is not on
     * this host — which is the second most likely setup failure and the thing a
     * single on/off chip would hide completely.
     */
    status({ ...FLOW_STATUS, listening: false, address: null, port: null });
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/socket is not open/i)).toBeInTheDocument();
    expect(screen.getByText(/port is already in use|not on this host/i)).toBeInTheDocument();
    // And not the off state, which would send the reader to the wrong fix.
    expect(screen.queryByText(/flow collection is off/i)).not.toBeInTheDocument();
  });

  it('explains how to switch it on when it is off', async () => {
    // A blank page reading "0 datagrams" is indistinguishable from a broken one,
    // and off-by-default is deliberate here.
    status(FLOW_OFF);
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/flow collection is off/i)).toBeInTheDocument();
    expect(screen.getByText(/Administration settings/i)).toBeInTheDocument();
  });

  it('offers the form first and the file second, because the file pins the form', async () => {
    /*
     * This panel used to lead with a block to paste into `api/.env` and mention
     * the administration form as a trailing "can also" — so the empty state a
     * first-time operator is most likely to be looking at recommended the one
     * route that costs them the form.
     *
     * Setting `FLOW_ENABLED` or `FLOW_PORT` in a file is precisely what makes the
     * resolver treat them as pinned: three of the four controls render disabled,
     * permanently, with editing the file again as the only way back. It is the
     * state `env-defaults.test.ts` fails the build over, printed as an
     * instruction.
     */
    status(FLOW_OFF);
    renderApp(<FlowPage />, { authenticated: true });

    const form = await screen.findByText(/Administration settings/i);
    const file = screen.getByText(/FLOW_ENABLED=true/);

    // Ordering, not merely presence: the recommendation is which one comes first.
    expect(form.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // And the file route says what it costs, which nothing did before.
    expect(screen.getByText(/wins over the form and disables that field/i)).toBeInTheDocument();
  });

  it('keeps the allowlist out of the block it tells people to paste', async () => {
    // The field an operator revises most often after the first run, as devices
    // are added — so pinning that one is the most expensive of the four.
    status(FLOW_OFF);
    renderApp(<FlowPage />, { authenticated: true });

    await screen.findByText(/flow collection is off/i);
    expect(screen.queryByText(/FLOW_EXPORTERS=/)).not.toBeInTheDocument();
  });

  it('names templates as the cause when nothing decodes', async () => {
    /*
     * The sharp case. A v9 or IPFIX exporter that sends data records before the
     * templates describing them is counted in `datagrams`, decodes nothing, and
     * looks identical to a working device from any total — so the page has to say
     * "awaiting templates" rather than leave an operator staring at a datagram
     * count that is going up.
     */
    status({
      ...FLOW_STATUS,
      records: 0,
      ignoredReasons: { notAllowed: 0, sflow: 0, unsupportedVersion: 0 },
      ignored: 0,
      exporters: [{ ...FLOW_STATUS.exporters[1]! }],
    });
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/every record is waiting for a template/i)).toBeInTheDocument();
    // Including the remedy, since "resend the template" is a setting on the
    // device rather than anything in this application.
    expect(screen.getByText(/shorten the template refresh/i)).toBeInTheDocument();
  });

  it('distinguishes waiting for a first datagram from receiving nothing useful', async () => {
    // Zero datagrams is a different problem from datagrams that do not decode:
    // one is reachability, the other is the exporter's configuration.
    status({
      ...FLOW_STATUS,
      datagrams: 0,
      records: 0,
      ignored: 0,
      ignoredReasons: { notAllowed: 0, sflow: 0, unsupportedVersion: 0 },
      exporters: [],
    });
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/nothing has arrived yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/none of them decoded/i)).not.toBeInTheDocument();
  });

  it('breaks the discarded count into causes, each fixed somewhere else', async () => {
    /*
     * `ignored` counted three unrelated things under one number: an allowlist
     * that does not include the device, a device configured for sFlow, and a
     * version with no parser. The API now reports them separately — this is the
     * same complaint the route's docblock makes about record totals, one level
     * down.
     */
    renderApp(<FlowPage />, { authenticated: true });

    const panel = await screen.findByText(/datagrams discarded/i);
    expect(panel).toBeInTheDocument();
    expect(screen.getByText(/sender not permitted/i)).toBeInTheDocument();
    expect(screen.getByText('sFlow')).toBeInTheDocument();
    // The zero cause is omitted rather than shown as a zero: three lines with one
    // number on them is the summary this panel replaced.
    expect(screen.queryByText(/version not implemented/i)).not.toBeInTheDocument();
  });

  it('does not call one stray refusal a rejected allowlist', async () => {
    /*
     * The branch used to fire on `notAllowed > 0 && records === 0`, which claims
     * "all of it was refused" from evidence that says "some of it was" — and
     * `records === 0` is the state somebody opens this page in, so the wrong
     * answer appeared exactly when the right one mattered.
     *
     * Here: an exporter is behaving correctly and its templates have not arrived,
     * plus one packet from an address nobody listed. The operator needs to be
     * told about the templates, not sent to their allowlist.
     */
    status({
      ...FLOW_STATUS,
      datagrams: 501,
      records: 0,
      ignored: 1,
      ignoredReasons: { notAllowed: 1, sflow: 0, unsupportedVersion: 0 },
      exporters: [{ ...FLOW_STATUS.exporters[1]! }],
    });
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/every record is waiting for a template/i)).toBeInTheDocument();
    expect(screen.queryByText(/and nothing was accepted/i)).not.toBeInTheDocument();
  });

  it('does say so when every datagram really was refused', async () => {
    // The other side, so the branch is not simply unreachable now.
    status({
      ...FLOW_STATUS,
      datagrams: 7,
      records: 0,
      ignored: 7,
      ignoredReasons: { notAllowed: 7, sflow: 0, unsupportedVersion: 0 },
      exporters: [],
    });
    renderApp(<FlowPage />, { authenticated: true });

    // The number interpolated, not the bare key — see the branch test below.
    expect(await screen.findByText(/7 datagrams were refused/i)).toBeInTheDocument();
  });

  it('says so when nothing decoded and none of the usual causes fits', async () => {
    /*
     * The last branch, and it needs a test as much as the others: every one of
     * these renders a message with parameters, and a `t()` call that omits one
     * renders the raw key — which looks like a missing translation rather than a
     * bug, and nothing in the catalogue guards can see it, because they check
     * the catalogue against itself rather than against the call sites.
     *
     * Two of these branches shipped that way until a test reached them.
     */
    status({
      ...FLOW_STATUS,
      datagrams: 40,
      records: 0,
      ignored: 0,
      ignoredReasons: { notAllowed: 0, sflow: 0, unsupportedVersion: 0 },
      exporters: [{ ...FLOW_STATUS.exporters[0]!, records: 0, pendingTemplates: 0 }],
    });
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/none of them decoded/i)).toBeInTheDocument();
    // The count really interpolated, rather than the key rendering as itself.
    expect(screen.getByText(/40 datagrams received/i)).toBeInTheDocument();
  });

  it('prints the allowlist a refused sender was measured against', async () => {
    // "7 refused" names a problem and not its cause. Beside the permitted list,
    // comparing a device's address to it IS the diagnosis.
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/permitted senders/i)).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1, 10\.0\.0\.2/)).toBeInTheDocument();
  });

  it('hides the discard panel when nothing has been discarded', async () => {
    // The panel's value is being conspicuous on a broken installation, which it
    // cannot be if it is also on screen for every healthy one.
    status({
      ...FLOW_STATUS,
      ignored: 0,
      ignoredReasons: { notAllowed: 0, sflow: 0, unsupportedVersion: 0 },
    });
    renderApp(<FlowPage />, { authenticated: true });

    await screen.findByText(/listening on/i);
    expect(screen.queryByText(/datagrams discarded/i)).not.toBeInTheDocument();
  });

  it('flags an exporter sending a version it cannot read, with the version number', async () => {
    // The number is what the operator takes to the device's configuration, so the
    // cell shows it rather than a bare "unsupported".
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText('Version 7')).toBeInTheDocument();
  });

  it('lists each exporter with its pending-template count', async () => {
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('IPFIX')).toBeInTheDocument();
    expect(screen.getByText('NetFlow v9')).toBeInTheDocument();
    /*
     * Twice, and that is the assertion: the headline tile sums the pending
     * counts across exporters, and this fixture has one exporter with any. So
     * the tile and the row must agree — a tile computed from anything other than
     * the rows underneath it is the kind of quiet disagreement that makes a
     * status panel stop being trusted.
     */
    expect(screen.getAllByText('640')).toHaveLength(2);
  });

  it('explains the empty exporter list rather than showing a blank table', async () => {
    status({
      ...FLOW_STATUS,
      datagrams: 0,
      records: 0,
      ignored: 0,
      ignoredReasons: { notAllowed: 0, sflow: 0, unsupportedVersion: 0 },
      exporters: [],
    });
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/no exporter has sent anything/i)).toBeInTheDocument();
    // With the port to configure the device against, which is the next thing the
    // reader needs and is not otherwise on screen.
    expect(screen.getByText(/port 2055/i)).toBeInTheDocument();
  });

  it('warns about the Compose port, which no counter here can reveal', async () => {
    /*
     * `docker-compose.flow.yml` publishes the UDP port and the main file
     * deliberately does not. Without that override the collector binds inside the
     * container, reports itself listening, and receives nothing — and every
     * counter on this page reads exactly as "the device is not sending". The
     * warning is the only place the real cause appears.
     */
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/needs a second file/i)).toBeInTheDocument();
    // The command itself, not just the filename — the filename appears in the
    // prose above it too, and what an operator needs is the line to paste.
    expect(screen.getByText(/-f docker-compose\.yml -f docker-compose\.flow\.yml up -d/)).toBeInTheDocument();
  });

  it('reports a failure to read the status', async () => {
    server.use(http.get('/api/flow/status', () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/Could not read the flow collector status|nope/i)).toBeInTheDocument();
  });

  it('refetches on demand', async () => {
    let calls = 0;
    server.use(
      http.get('/api/flow/status', () => {
        calls += 1;
        return HttpResponse.json(FLOW_STATUS);
      }),
    );
    const user = userEvent.setup();
    renderApp(<FlowPage />, { authenticated: true });

    await screen.findByText(/listening on/i);
    const before = calls;
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    expect(calls).toBeGreaterThan(before);
  });

  it('is readable by a plain user, because the endpoint is', async () => {
    /*
     * Deliberate, and recorded in `route-guards.test.ts` as the flow router's
     * posture: whether the collector is listening is not privileged information,
     * and the page changes nothing. Gating it would be its own mistake — the
     * operator watching the network is usually not the administrator.
     */
    server.use(
      http.get('/auth/me', () =>
        HttpResponse.json({ id: 2, email: 'user@example.com', role: 'USER', langCode: 'en' }),
      ),
    );
    renderApp(<FlowPage />, { authenticated: true });

    const panel = await screen.findByText(/listening on 0\.0\.0\.0:2055/i);
    expect(panel).toBeInTheDocument();
    expect(within(document.body).queryByText(/not authorised/i)).not.toBeInTheDocument();
  });

  it('still reports an allowlist refusing everything after it was edited', async () => {
    /*
     * The diagnosis for a mistyped allowlist, which is the commonest way to
     * configure this wrong — and it was measured against the binding's whole
     * datagram history. The refusal counter restarts when the allowlist changes,
     * because it was counted against a list that no longer exists, so the two
     * could never be equal again after exactly the edit that caused the problem.
     *
     * This is the shape the server sends afterwards: datagrams carrying their
     * history, the span and the refusals restarted together.
     */
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({
          ...FLOW_STATUS,
          datagrams: 5120,
          datagramsUnderAllowlist: 40,
          records: 0,
          ignored: 40,
          ignoredReasons: { notAllowed: 40, sflow: 0, unsupportedVersion: 0 },
        }),
      ),
    );
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/40 datagrams were refused/i)).toBeInTheDocument();
  });

  it('does not claim everything was refused when only some of it was', async () => {
    // The other half, and the reason the branch is a ratio rather than a
    // non-zero test: one stray packet from a decommissioned device must not read
    // as an allowlist rejecting the estate.
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({
          ...FLOW_STATUS,
          datagramsUnderAllowlist: 40,
          ignoredReasons: { notAllowed: 1, sflow: 0, unsupportedVersion: 0 },
        }),
      ),
    );
    renderApp(<FlowPage />, { authenticated: true });

    await screen.findByText(/listening on/i);
    expect(screen.queryByText(/datagram was refused/i)).not.toBeInTheDocument();
  });

  it('points the operator at the configured port when nothing is bound', async () => {
    /*
     * `port` is null with no socket open, and `?? 0` turned the one sentence
     * that tells an operator where to aim a device into "export to this host on
     * port 0". The overlap is what made it bad: this hint shows when nothing has
     * arrived, and a failed bind is one of the main reasons nothing has.
     */
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({
          ...FLOW_STATUS,
          listening: false,
          address: null,
          port: null,
          configuredPort: 4739,
          exporters: [],
        }),
      ),
    );
    renderApp(<FlowPage />, { authenticated: true });

    expect(await screen.findByText(/on port 4739/i)).toBeInTheDocument();
    expect(screen.queryByText(/on port 0([^0-9]|$)/i)).not.toBeInTheDocument();
  });
});
