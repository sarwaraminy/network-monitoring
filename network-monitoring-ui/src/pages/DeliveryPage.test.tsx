import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { NOTIFY_STATUS } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import DeliveryPage from './DeliveryPage';

/**
 * The delivery page.
 *
 * What is asserted here is the states that mean "you think you are covered and
 * you are not": nothing configured, channels configured but the feature off, and
 * a test send that partly failed. Those are the reasons an alert does not arrive,
 * and none of them produce an error anywhere until the night it matters.
 */

describe('DeliveryPage', () => {
  it('separates the human channels from the SIEM feed', async () => {
    // Not cosmetic. The gates below only apply to the left-hand column, and
    // listing syslog beside "min severity: high" would be actively misleading.
    renderApp(<DeliveryPage />, { authenticated: true });

    expect(await screen.findByText('For people')).toBeInTheDocument();
    expect(screen.getByText('For a SIEM')).toBeInTheDocument();
    expect(screen.getByText('Every finding, ungated')).toBeInTheDocument();
  });

  it('shows each channel with whether it is actually configured', async () => {
    renderApp(<DeliveryPage />, { authenticated: true });

    expect(await screen.findByText('Webhook')).toBeInTheDocument();
    expect(screen.getByText('Syslog')).toBeInTheDocument();
    expect(screen.getByText('siem.internal:514')).toBeInTheDocument();
    // Email is off in the fixture, so the state must be visible rather than implied.
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
  });

  it('gives the server’s reason for an unconfigured mailbox, not the standing one', async () => {
    /*
     * An OAuth2 mailbox missing its refresh token is correctly not "configured" — but
     * the standing sentence for an unconfigured channel names an SMTP host, a sender
     * and recipients, which are exactly the three things that operator has already
     * set. Naming the wrong cause on the screen they are looking at is the same
     * failure as claiming the channel was ready.
     */
    server.use(
      http.get('/api/notify/status', () =>
        HttpResponse.json({
          ...NOTIFY_STATUS,
          email: {
            configured: false,
            recipients: 2,
            reason:
              'Email is set to OAuth2 but SMTP_OAUTH_REFRESH_TOKEN is not set, so the mailbox cannot authenticate.',
          },
        }),
      ),
    );

    renderApp(<DeliveryPage />, { authenticated: true });

    expect(await screen.findByText(/SMTP_OAUTH_REFRESH_TOKEN/)).toBeInTheDocument();
    expect(screen.queryByText(/SMTP host, sender and at least one recipient/i)).not.toBeInTheDocument();
  });

  it('falls back to the standing reason when the server has none', async () => {
    // A mailbox that is simply unset. `reason` is null, and the generic sentence is
    // the right one — it must not disappear along with the special case.
    renderApp(<DeliveryPage />, { authenticated: true });

    expect(await screen.findByText(/SMTP host, sender and at least one recipient/i)).toBeInTheDocument();
  });

  it('shows the gates, because each one is a reason an alert did not arrive', async () => {
    renderApp(<DeliveryPage />, { authenticated: true });

    expect(await screen.findByText('Minimum severity')).toBeInTheDocument();
    expect(screen.getByText('Per-finding throttle')).toBeInTheDocument();
    expect(screen.getByText('12/h')).toBeInTheDocument();
  });

  it('warns when nothing at all is configured', async () => {
    // Findings recorded, nobody told — the worst state and the quietest.
    server.use(
      http.get('/api/notify/status', () =>
        HttpResponse.json({
          ...NOTIFY_STATUS,
          channels: [],
          active: false,
          webhook: { configured: false, format: null },
          syslog: { ...NOTIFY_STATUS.syslog, configured: false, target: null },
        }),
      ),
    );

    renderApp(<DeliveryPage />, { authenticated: true });
    expect(await screen.findByText(/nobody is told/i)).toBeInTheDocument();
  });

  it('calls out channels that are configured but switched off', async () => {
    // Confusing on its own: the channel list is populated and the test button
    // works, yet no alert is ever sent.
    //
    // The copy used to name NOTIFY_ENABLED, because editing api/.env and restarting
    // was the only way to change it. It is now a switch on this page, so pointing an
    // administrator at a file would be worse advice than pointing them at the
    // control — and telling a non-admin to edit a file they cannot reach was never
    // useful either.
    server.use(http.get('/api/notify/status', () => HttpResponse.json({ ...NOTIFY_STATUS, enabled: false })));

    renderApp(<DeliveryPage />, { authenticated: true });
    expect(await screen.findByText(/delivery is switched off/i)).toBeInTheDocument();
    expect(screen.getByText(/Turn on "Deliver alerts" in Settings above/)).toBeInTheDocument();
    expect(screen.getByText(/Syslog is unaffected/)).toBeInTheDocument();
  });

  it('sends a test and reports what was delivered', async () => {
    const user = userEvent.setup();
    renderApp(<DeliveryPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /send test/i }));
    expect(await screen.findByText(/Delivered to 2 channel/i)).toBeInTheDocument();
  });

  it('names the channel that failed rather than reporting a count', async () => {
    // "1 of 2 delivered" sends you to the logs; naming it does not.
    server.use(
      http.post('/api/notify/test', () =>
        HttpResponse.json({
          delivered: 1,
          results: [
            { channel: 'webhook', ok: true, detail: 'delivered' },
            { channel: 'email', ok: false, detail: 'invalid login' },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    renderApp(<DeliveryPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /send test/i }));
    expect(await screen.findByText(/email — invalid login/i)).toBeInTheDocument();
  });

  it('reports a status failure instead of rendering an empty page', async () => {
    server.use(http.get('/api/notify/status', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderApp(<DeliveryPage />, { authenticated: true });
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });
});
