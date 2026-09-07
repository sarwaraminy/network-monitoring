import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { useAuth } from '../contexts/AuthContext';
import { ADMIN_USER, CRITICAL_ALERT, HIGH_ALERT } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import AlertsPage from './AlertsPage';

/**
 * The alerts table — the app's primary view.
 *
 * The most valuable assertion here is the privacy one: the credential detector
 * records a username and a password *length*, never the password, and the evidence
 * panel renders whatever the API sends. A regression that started shipping secrets
 * would otherwise be invisible.
 */

const ALERTS = [CRITICAL_ALERT, HIGH_ALERT];

async function renderAlerts() {
  const result = renderApp(<AlertsPage />, { authenticated: true });
  // Wait for the first row rather than an arbitrary delay.
  await waitFor(() => expect(screen.getByText(/cleartext http credentials/i)).toBeInTheDocument(), {
    timeout: 10_000,
  });
  return result;
}

/**
 * The same, but not returning until the signed-in role is known.
 *
 * Only the role tests need this, and they need it absolutely: a row on screen says
 * the alert query landed and nothing at all about the auth query. See `RoleProbe`.
 */
async function renderAlertsAs(role: 'ADMIN' | 'USER') {
  if (role === 'USER') asNonAdmin();

  const result = renderApp(
    <>
      <RoleProbe />
      <AlertsPage />
    </>,
    { authenticated: true },
  );

  await waitFor(() => expect(screen.getByText(/cleartext http credentials/i)).toBeInTheDocument(), {
    timeout: 10_000,
  });
  // The same generous timeout as the row wait above. `waitFor` defaults to one
  // second, which is under what a cold render costs here.
  await waitFor(() => expect(screen.getByTestId('resolved-role')).toHaveTextContent(role), {
    timeout: 10_000,
  });

  return result;
}

/** Signs in as a plain user instead of the default admin. */
function asNonAdmin() {
  server.use(http.get('/auth/me', () => HttpResponse.json({ ...ADMIN_USER, role: 'USER' })));
}

/**
 * Reports the resolved role, so a test can wait for the auth query to have
 * *committed* rather than merely to have been sent.
 *
 * Test-only, and it exists because of a real gap. `/auth/me` is a separate request
 * from the alert list, and nothing on this page renders differently while it is in
 * flight except the control under test — so an assertion that the delete button is
 * absent was satisfied by `user` still being null, not by `isAdmin` being false. It
 * would have gone green with the role check deleted, given a slow enough auth
 * response, and green for the right reason and green for the wrong one look
 * identical from the outside.
 */
function RoleProbe() {
  const { user } = useAuth();
  return <span data-testid="resolved-role">{user?.role ?? 'pending'}</span>;
}

describe('AlertsPage', () => {
  it('lists unacknowledged findings with their severity', async () => {
    await renderAlerts();

    expect(screen.getByText(/cleartext http credentials/i)).toBeInTheDocument();
    expect(screen.getByText(/port scan: 10\.0\.0\.66/i)).toBeInTheDocument();
    // "Open only" is on by default, so the acknowledged one is filtered out.
    expect(screen.queryByText(/new device on the network/i)).not.toBeInTheDocument();

    // Severity names appear twice on the page — once on a summary tile and once
    // as a row chip — so scope to the table to assert about the rows.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Critical')).toBeInTheDocument();
    expect(table.getByText('High')).toBeInTheDocument();
  });

  it('shows the occurrence count for a repeated finding', async () => {
    await renderAlerts();
    // The critical alert has occurrences: 3.
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('renders the severity summary tiles', async () => {
    await renderAlerts();
    const tiles = screen
      .getAllByRole('button')
      .filter((node) => /All alerts|Critical|High/.test(node.textContent ?? ''));
    expect(tiles.length).toBeGreaterThan(0);
    expect(screen.getByText('All alerts')).toBeInTheDocument();
  });

  it('filters by detector and asks the server for it', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/api/alerts', ({ request }) => {
        const url = new URL(request.url);
        requested.push(url.searchParams.get('kind') ?? '');
        const kind = url.searchParams.get('kind');
        return HttpResponse.json(
          kind === 'port_scan'
            ? [
                {
                  id: 102,
                  kind: 'port_scan',
                  severity: 'high',
                  title: 'Port scan: 10.0.0.66 probed 22 ports on 10.0.0.89',
                  description: 'x',
                  sourceIp: '10.0.0.66',
                  sourceMac: null,
                  targetIp: '10.0.0.89',
                  targetMac: null,
                  protocol: 'TCP',
                  dedupKey: 'k',
                  occurrences: 1,
                  firstSeen: '2026-07-26T08:00:00.000Z',
                  lastSeen: '2026-07-26T08:01:00.000Z',
                  evidence: {},
                  acknowledgedAt: null,
                  acknowledgedBy: null,
                  createdAt: '2026-07-26T08:00:00.000Z',
                },
              ]
            : [],
        );
      }),
    );

    const user = userEvent.setup();
    renderApp(<AlertsPage />, { authenticated: true });
    await waitFor(() => expect(requested.length).toBeGreaterThan(0), { timeout: 10_000 });

    await user.click(screen.getByRole('combobox', { name: /detector/i }));
    await user.click(await screen.findByRole('option', { name: /port scan/i }));

    await waitFor(() => expect(requested).toContain('port_scan'));
  });

  it('shows evidence without ever exposing the password', async () => {
    const user = userEvent.setup();
    await renderAlerts();

    // The table has an expand-all toggle in the header as well as a per-row
    // expander. Take the row's own, or every row opens and the assertions below
    // match several panels at once.
    const criticalRow = screen.getByText(/cleartext http credentials/i).closest('tr');
    expect(criticalRow).not.toBeNull();
    await user.click(within(criticalRow as HTMLElement).getByRole('button', { name: /expand/i }));

    expect(await screen.findByText(/what this means/i)).toBeInTheDocument();
    expect(screen.getByText(/^Evidence$/)).toBeInTheDocument();
    // Username is actionable and shown; the length proves a secret was present.
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();

    // The privacy contract: the fact is recorded, the secret is not.
    expect(screen.getByText(/password recorded/i)).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/passwordRecorded["']?\s*:\s*true/i);
  });

  it('acknowledges a finding', async () => {
    let acknowledged = 0;
    server.use(
      http.post('/api/alerts/:id/acknowledge', () => {
        acknowledged += 1;
        return HttpResponse.json({ ...{}, id: 101, acknowledgedAt: '2026-07-26T10:00:00.000Z' });
      }),
    );

    const user = userEvent.setup();
    await renderAlerts();

    await user.click(screen.getAllByRole('button', { name: /^acknowledge$/i })[0]!);
    await waitFor(() => expect(acknowledged).toBe(1));
  });

  it('offers an administrator the per-row delete', async () => {
    await renderAlertsAs('ADMIN');

    // The control the two tests below are about. Asserted from the admin side
    // first, so "absent for a user" cannot pass because the button moved, was
    // renamed, or stopped rendering for everybody. Plural, because there is one
    // per row and the singular query throws on more than one match — which is
    // how the first version of this test failed while the code was correct.
    expect(await screen.findAllByRole('button', { name: /delete finding/i })).not.toHaveLength(0);
  });

  it('does not offer a plain user a delete it would be refused', async () => {
    /*
     * `DELETE /api/alerts/:id` requires ADMIN on the server. Before this gate
     * existed the button was rendered for every signed-in account, and once the
     * route was gated a USER clicking it got a 403 banner every time — an action
     * offered and then refused, which reads as a broken product rather than as a
     * permission.
     *
     * Every other page here already works this way (`SuppressionsPage`,
     * `DeliveryPage`, `ThreatIntelPage`, and the account menu in `AppLayout`), so
     * this was the outlier. The server is still what enforces it; hiding the
     * control only stops offering somebody something it would refuse.
     */
    await renderAlertsAs('USER');

    // Past the wait above, `user` is loaded and its role is USER, so an absent
    // button can only mean the role check — not a request still in flight.
    expect(screen.queryAllByRole('button', { name: /delete finding/i })).toHaveLength(0);
  });

  it('still lets a plain user acknowledge', async () => {
    // The other half, and the reason the row keeps an actions column instead of
    // dropping it wholesale for a non-admin the way the rules table does.
    // Acknowledging is what an operator does all day; gating it would mean the
    // people watching the network could not mark their own work.
    await renderAlertsAs('USER');

    expect(await screen.findAllByRole('button', { name: /^acknowledge$|^reopen$/i })).not.toHaveLength(0);
  });

  it('reports a load failure instead of showing an empty table', async () => {
    server.use(
      http.get('/api/alerts', () => HttpResponse.json({ message: 'Database is down' }, { status: 500 })),
    );

    renderApp(<AlertsPage />, { authenticated: true });
    expect(await screen.findByText(/database is down/i, {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('explains an empty result rather than looking broken', async () => {
    server.use(http.get('/api/alerts', () => HttpResponse.json([])));

    renderApp(<AlertsPage />, { authenticated: true });
    expect(await screen.findByText(/nothing to report/i, {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  /**
   * The sensor controls, which exist only when there is a choice to make.
   *
   * Every installation has one sensor until somebody deploys a second, and for
   * those this page must be unchanged: a column repeating one value on every row
   * costs width and says nothing, and a filter offering a single option is a
   * control that cannot do anything. So the interesting assertion is the negative
   * one — it is what keeps this feature from taxing the installations that will
   * never use it.
   */
  it('hides the sensor column and filter while there is only one sensor', async () => {
    await renderAlerts();

    expect(screen.queryByRole('combobox', { name: /sensor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /sensor/i })).not.toBeInTheDocument();
  });

  it('shows them, and narrows the list, once a second sensor has reported', async () => {
    server.use(
      http.get('/api/alerts/sensors', () =>
        HttpResponse.json([
          { sensorId: 'branch-office', self: false, alerts: 1, latestAt: null },
          { sensorId: 'default', self: true, alerts: 1, latestAt: null },
        ]),
      ),
    );

    const user = userEvent.setup();
    await renderAlerts();

    expect(await screen.findByRole('columnheader', { name: /sensor/i })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /sensor/i }));
    // The sensor serving the page says so: an operator who reached this address
    // through one of them has no other way to tell which it is.
    await user.click(await screen.findByRole('option', { name: /default \(this one\)/i }));

    // The fixtures are both `default`, so `branch-office` is the case that proves
    // the parameter reached the server rather than being dropped.
    await user.click(screen.getByRole('combobox', { name: /sensor/i }));
    await user.click(await screen.findByRole('option', { name: /branch-office/i }));

    await waitFor(() => expect(screen.getByText(/nothing to report/i)).toBeInTheDocument(), {
      timeout: 10_000,
    });
  });

  it('stops applying the sensor filter when the sensor list shrinks under it', async () => {
    /*
     * The failure this prevents looks like "the alerts are gone".
     *
     * `listSensors` reads the `alerts` table, so the list shrinks in ordinary
     * operation — Clear All empties it, and retention rolls a quiet sensor's rows
     * away. Hiding the control does not clear what it selected, so without the
     * derivation in AlertsPage the filter goes on applying with nothing on screen
     * to undo it and no cause an operator can see. A reload does not help either,
     * since the state is rebuilt from the same data.
     *
     * Driven here through acknowledging, which is the most ordinary action on
     * this page and invalidates `['alerts']` — the prefix the sensor list is
     * cached under, so it refetches and the second sensor is gone.
     */
    const requested: string[] = [];
    let sensorRows = [
      { sensorId: 'branch-office', self: false, alerts: 1, latestAt: null },
      { sensorId: 'default', self: true, alerts: 2, latestAt: null },
    ];

    server.use(
      http.get('/api/alerts/sensors', () => HttpResponse.json(sensorRows)),
      http.get('/api/alerts', ({ request }) => {
        const url = new URL(request.url);
        requested.push(url.searchParams.get('sensor') ?? '');
        return HttpResponse.json(ALERTS.filter((alert) => alert.acknowledgedAt === null));
      }),
    );

    const user = userEvent.setup();
    await renderAlerts();

    await user.click(await screen.findByRole('combobox', { name: /sensor/i }));
    await user.click(await screen.findByRole('option', { name: /branch-office/i }));
    await waitFor(() => expect(requested.at(-1)).toBe('branch-office'));

    // The second sensor goes quiet, and something invalidates the list.
    sensorRows = [{ sensorId: 'default', self: true, alerts: 2, latestAt: null }];
    await user.click(screen.getAllByRole('button', { name: /^acknowledge$|^reopen$/i })[0]!);

    await waitFor(() => expect(screen.queryByRole('combobox', { name: /sensor/i })).not.toBeInTheDocument());
    // The control is gone, and so is the filter it was driving.
    await waitFor(() => expect(requested.at(-1)).toBe(''));
  });

  it('looks up an IP address from the table', async () => {
    const user = userEvent.setup();
    await renderAlerts();

    // Source addresses are buttons that open the lookup dialog.
    await user.click(screen.getAllByRole('button', { name: /10\.0\.0\.89/ })[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/example\.invalid/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/whois output for testing/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Testland/i)).toBeInTheDocument();
  });
});
