import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { FLOW_SETTINGS, FLOW_STATUS } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import FlowSettings from './FlowSettings';

/**
 * Flow settings, from the administrator's side.
 *
 * The reason this form exists is a customer with no shell on the server: these
 * four variables were read once at boot and changeable no other way, so setting
 * up flow meant editing a file they may have no access to. What the cases below
 * are about is the two things that make the form honest rather than merely
 * present.
 *
 *  - **Not all four fields cost the same.** The allowlist is a filter test per
 *    datagram and applies immediately; the other three are properties of a bound
 *    socket, so saving one drops a few seconds of collection. The form separates
 *    them and says which is which.
 *  - **A save can succeed and still not work.** The row is written, the socket is
 *    reopened, and the bind can fail — the port is taken, or the address is not on
 *    this host. That is not a failed request and must not be reported as one, nor
 *    as a success.
 */

type SettingsBody = typeof FLOW_SETTINGS;

/** Replaces the settings for one test. */
const settings = (body: SettingsBody) =>
  server.use(http.get('/api/flow/settings', () => HttpResponse.json(body)));

const pin = (...fields: string[]) => settings({ ...FLOW_SETTINGS, pinned: fields });

describe('FlowSettings', () => {
  it('shows what is in force, from whichever layer decided it', async () => {
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByDisplayValue('10.0.0.1, 10.0.0.2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2055')).toBeInTheDocument();
    // MUI renders a Switch as a checkbox input; the accessible name comes from
    // the `aria-label` on it rather than from the label beside it.
    expect(screen.getByLabelText('Collect flow data')).toBeChecked();
  });

  it('separates the allowlist from the settings that reopen the socket', async () => {
    // The distinction is the point of the layout: one costs nothing, three cost
    // a few seconds of not collecting, and an operator should know which before
    // pressing Save rather than after.
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByText(/which senders are accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/closes and reopens the socket/i)).toBeInTheDocument();
  });

  it('warns that the published port is not this form’s to change', async () => {
    /*
     * Under Docker the host port is forwarded by `docker-compose.flow.yml`, which
     * this application cannot see. A port changed here rebinds inside the
     * container while Docker keeps forwarding the old one, so collection stops
     * and every counter reads exactly like a device that is not sending — the
     * failure with no symptom, which is why the warning is beside the field
     * rather than in the documentation.
     */
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByText(/published port is a separate file/i)).toBeInTheDocument();
  });

  it('sends only the field that moved', async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/flow/settings', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...FLOW_SETTINGS, rebound: false, status: FLOW_STATUS });
      }),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const exporters = await screen.findByDisplayValue('10.0.0.1, 10.0.0.2');
    await user.clear(exporters);
    await user.type(exporters, '10.0.0.9');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).not.toBeNull());
    // Not the port, not the bind address, not the switch: sending an unchanged
    // field would rebind the socket for an edit that touched only the filter.
    expect(sent).toEqual({ exporters: '10.0.0.9' });
  });

  it('says when a save took effect without reopening the socket', async () => {
    // The everyday case, and worth its own message: the allowlist applies at once
    // and nothing in flight was lost.
    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const exporters = await screen.findByDisplayValue('10.0.0.1, 10.0.0.2');
    await user.clear(exporters);
    await user.type(exporters, '10.0.0.9');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/^Saved, and in force\.$/)).toBeInTheDocument();
  });

  it('says when the socket was reopened, because traffic was missed', async () => {
    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const port = await screen.findByDisplayValue('2055');
    await user.clear(port);
    await user.type(port, '4739');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/closed and reopened/i)).toBeInTheDocument();
  });

  it('reports a save that stored the value and could not bind it', async () => {
    /*
     * The case that must not read as a success. The row was written and is what
     * the next restart will use, so the request did not fail — but the collector
     * is not listening, and a tick here would be a lie the operator only
     * discovers when no findings arrive.
     */
    server.use(
      http.put('/api/flow/settings', () =>
        HttpResponse.json({
          settings: {
            ...FLOW_SETTINGS.settings,
            port: { source: 'database', env: 'FLOW_PORT', value: 4739 },
          },
          pinned: [],
          // The server always reports what it wrote, and the form now reads it:
          // a failed bind after a real write is a different message from a failed
          // bind after a retry that wrote nothing.
          changed: true,
          rebound: true,
          status: { ...FLOW_STATUS, listening: false, address: null, port: null },
        }),
      ),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const port = await screen.findByDisplayValue('2055');
    await user.clear(port);
    await user.type(port, '4739');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/could not bind and is NOT listening/i)).toBeInTheDocument();
  });

  it('disables a pinned field and names the variable holding it', async () => {
    // The three-layer guarantee, from the side that has to explain itself: the
    // control is dead and the reader is told exactly which line to remove.
    pin('port');
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByDisplayValue('2055')).toBeDisabled();
    expect(screen.getByText(/Set by FLOW_PORT in the environment/)).toBeInTheDocument();
  });

  it('drops the published-port warning when the port cannot be edited here', async () => {
    // On the flow Compose overlay the port is pinned, so the mistake is
    // unreachable and the warning would be noise.
    pin('port');
    renderApp(<FlowSettings />, { authenticated: true });

    await screen.findByDisplayValue('2055');
    expect(screen.queryByText(/published port is a separate file/i)).not.toBeInTheDocument();
  });

  it('explains a form that is entirely pinned rather than looking broken', async () => {
    /*
     * A reachable state — a deployment driven by config management is entitled to
     * it — and four dead controls with no explanation is what somebody files a
     * bug about. It also says nothing is lost by unpinning, which is the part
     * that is not obvious.
     */
    pin('enabled', 'port', 'bindAddress', 'exporters');
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByText(/Every field here is set in the environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('is a form and not a report', async () => {
    /*
     * The whole status panel was rendered under these fields for a while — the
     * counters, the exporter table, the diagnosis — on the argument that watching
     * the socket come back is how you tell a save took effect. That made a
     * settings window into a monitoring screen, which is the thing the query
     * console's diagnostics were taken out of the gear for.
     *
     * The two useful halves of that argument are kept without it: a save that
     * could not bind says so in the banner, and a collector that was already
     * stalled surfaces as the retry button below. Both read the status; neither
     * renders it.
     */
    renderApp(<FlowSettings />, { authenticated: true });

    await screen.findByDisplayValue('2055');
    expect(screen.queryByText(/listening on 0\.0\.0\.0:2055/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Datagrams')).not.toBeInTheDocument();
    expect(screen.queryByText('Exporters')).not.toBeInTheDocument();
  });

  it('clears the bind address rather than storing an empty string', async () => {
    /*
     * The same fix the port got, and it matters for a reason the port's did not
     * show: an empty string is stored, read back as unset, and resolves to the
     * `0.0.0.0` default — so clearing once appears to work, and clearing a second
     * time produces a patch the server sees as no change while the form still
     * says "Saved". The admin is told twice that something happened and the
     * second time nothing did.
     */
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/flow/settings', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...FLOW_SETTINGS, changed: true, rebound: true, status: FLOW_STATUS });
      }),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    await user.clear(await screen.findByDisplayValue('0.0.0.0'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({ bindAddress: null });
  });

  it('keeps an emptied allowlist as a value, because empty means something', async () => {
    /*
     * The deliberate asymmetry. An empty allowlist is a real choice — accept any
     * sender — so it must reach the server as `''` and not as the `null` that
     * clears the row and falls back to whatever the environment said. The two
     * ends have to agree; `resolveFlowSettings` reads a blank stored value for
     * exactly this reason.
     */
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/flow/settings', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...FLOW_SETTINGS, changed: true, rebound: false, status: FLOW_STATUS });
      }),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    await user.clear(await screen.findByDisplayValue('10.0.0.1, 10.0.0.2'));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({ exporters: '' });
  });

  it('does not claim a save when nothing was written', async () => {
    // The false success the round trip above produces. The server reports what it
    // actually wrote, so the form can say so instead of crediting a change that
    // did not happen.
    server.use(
      http.put('/api/flow/settings', () =>
        HttpResponse.json({ ...FLOW_SETTINGS, changed: false, rebound: false, status: FLOW_STATUS }),
      ),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const port = await screen.findByDisplayValue('2055');
    await user.clear(port);
    await user.type(port, '4739');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/Nothing changed/i)).toBeInTheDocument();
  });

  it('offers a retry only while the collector should be listening and is not', async () => {
    /*
     * The half that made the server's rebind-when-stalled branch unreachable. An
     * operator whose port was busy at boot frees it and comes back to a form
     * where every value is already correct — nothing differs, the patch is empty,
     * and Save refuses before a request is sent. The recovery was an API restart,
     * which is the shell access this feature exists to remove the need for.
     */
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({ ...FLOW_STATUS, listening: false, address: null, port: null }),
      ),
    );
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByRole('button', { name: /try binding again/i })).toBeInTheDocument();
  });

  it('hides the retry on a collector that is listening', async () => {
    // Absent on a working installation, rather than an always-present button
    // whose effect nobody can predict.
    renderApp(<FlowSettings />, { authenticated: true });

    await screen.findByDisplayValue('2055');
    expect(screen.queryByRole('button', { name: /try binding again/i })).not.toBeInTheDocument();
  });

  it('sends an empty patch for the retry, so nothing is written or audited', async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({ ...FLOW_STATUS, listening: false, address: null, port: null }),
      ),
      http.put('/api/flow/settings', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...FLOW_SETTINGS, changed: false, rebound: true, status: FLOW_STATUS });
      }),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /try binding again/i }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toEqual({});
    // And says what happened: the socket came back, nothing was stored.
    expect(await screen.findByText(/Nothing needed changing/i)).toBeInTheDocument();
  });

  it('does not carry a field the administrator never touched', async () => {
    /*
     * The silent revert, and the reason the draft is keyed per field.
     *
     * The draft used to snapshot all four values on the first keystroke and diff
     * that frozen object against a `live` that keeps moving — and it moves in
     * ordinary use, since the query defaults are `staleTime: 2000` with
     * `refetchOnWindowFocus: true`.
     *
     * So: an administrator starts editing the allowlist and leaves the dialog
     * open. Someone else changes the port to 4739. The refetch updates `live`,
     * the snapshot still holds 2055, and on save the patch carries `port: 2055`
     * — undoing a change nobody in this dialog made, and rebinding the socket to
     * do it, because `port` is a rebind field.
     */
    let reads = 0;
    server.use(
      http.get('/api/flow/settings', () => {
        reads += 1;
        // The second read is the concurrent change landing underneath the form.
        if (reads === 1) return HttpResponse.json(FLOW_SETTINGS);
        return HttpResponse.json({
          ...FLOW_SETTINGS,
          settings: {
            ...FLOW_SETTINGS.settings,
            port: { source: 'database', env: 'FLOW_PORT', value: 4739 },
          },
        });
      }),
    );

    let sent: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/flow/settings', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...FLOW_SETTINGS, changed: true, rebound: false, status: FLOW_STATUS });
      }),
    );

    const user = userEvent.setup();
    const { client } = renderApp(<FlowSettings />, { authenticated: true });

    // Touch one field, and only one.
    const exporters = await screen.findByDisplayValue('10.0.0.1, 10.0.0.2');
    await user.clear(exporters);
    await user.type(exporters, '10.0.0.9');

    // The port changes underneath, exactly as a background refetch would deliver it.
    await client.invalidateQueries({ queryKey: ['flow', 'settings'] });
    await screen.findByDisplayValue('4739');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(sent).not.toBeNull());

    expect(sent).toEqual({ exporters: '10.0.0.9' });
    // Said explicitly, because this is the whole failure: an untouched rebind
    // field in the patch reverts somebody else's change and reopens the socket.
    expect(sent).not.toHaveProperty('port');
  });

  it('ignores a field typed into and put back', async () => {
    // Membership in the draft is not a change. Letting it reach the patch would
    // rebind the socket for an edit that undid itself.
    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const port = await screen.findByDisplayValue('2055');
    await user.clear(port);
    await user.type(port, '2055');

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('does not credit a save to a retry that failed to bind', async () => {
    /*
     * The branch order that swallowed the fourth outcome.
     *
     * A retry sends an empty patch, so `changed` is false and nothing is written
     * or audited. When the rebind then fails, the not-listening branch caught it
     * first and reported `saved_not_listening` — "the setting is stored and will
     * be used at the next restart" — about a request that stored nothing.
     *
     * It is the worst place to say it. A failing retry is the case an operator
     * repeats, and being told the value is safely stored points them at a
     * restart when the port is in fact still taken.
     */
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({ ...FLOW_STATUS, listening: false, address: null, port: null }),
      ),
      http.put('/api/flow/settings', () =>
        HttpResponse.json({
          ...FLOW_SETTINGS,
          changed: false,
          rebound: true,
          status: { ...FLOW_STATUS, listening: false, address: null, port: null },
        }),
      ),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /try binding again/i }));

    expect(await screen.findByText(/still could not bind/i)).toBeInTheDocument();
    // The half that was the lie: nothing was saved, so nothing may claim to be
    // waiting for the next restart.
    expect(screen.queryByText(/will be used at the next restart/i)).not.toBeInTheDocument();
  });

  it('offers the retry when the socket is open on settings that have moved', async () => {
    /*
     * The third state. `enabled` and `listening` are both true, so every existing
     * check reads the collector as healthy — while it is bound to a port the
     * settings no longer name, which a boot that could not read the settings row
     * produces and nothing else can surface.
     */
    server.use(
      http.get('/api/flow/status', () =>
        HttpResponse.json({ ...FLOW_STATUS, listening: true, port: 2055, bindingOutOfDate: true }),
      ),
    );
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByRole('button', { name: /try binding again/i })).toBeInTheDocument();
  });

  it('reports a failure to read the settings', async () => {
    server.use(http.get('/api/flow/settings', () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByText(/Could not read the flow settings|nope/i)).toBeInTheDocument();
  });

  it('shows the server’s refusal when a field was pinned under it', async () => {
    // A background refetch can pin a field between an edit and the Save. The
    // server's message names the variable, which is the actionable half.
    server.use(
      http.put('/api/flow/settings', () =>
        HttpResponse.json(
          { message: 'Set in the environment and cannot be changed here: FLOW_EXPORTERS.' },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderApp(<FlowSettings />, { authenticated: true });

    const exporters = await screen.findByDisplayValue('10.0.0.1, 10.0.0.2');
    await user.clear(exporters);
    await user.type(exporters, '10.0.0.9');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // The banner, not the helper text underneath the field — both mention the
    // variable, and the one that matters is the server's own refusal.
    expect(await screen.findByText(/cannot be changed here: FLOW_EXPORTERS/)).toBeInTheDocument();
  });
});
