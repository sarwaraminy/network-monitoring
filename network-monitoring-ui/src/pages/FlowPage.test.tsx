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
 */
const status = (body: FlowStatus) => server.use(http.get('/api/flow/status', () => HttpResponse.json(body)));

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
    expect(screen.getByText(/FLOW_ENABLED=true/)).toBeInTheDocument();
    // And says the variables need a restart, which is true until the roadmap's
    // next half lands.
    expect(screen.getByText(/restarted/i)).toBeInTheDocument();
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
});
