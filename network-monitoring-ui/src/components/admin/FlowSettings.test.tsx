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

  it('shows the live collector state under the form', async () => {
    // Watching the socket come back is how an operator tells a save took effect,
    // which is why the status panel is embedded here rather than only on its page.
    renderApp(<FlowSettings />, { authenticated: true });

    expect(await screen.findByText(/listening on 0\.0\.0\.0:2055/i)).toBeInTheDocument();
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
