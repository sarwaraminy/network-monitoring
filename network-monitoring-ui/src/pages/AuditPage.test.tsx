import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADMIN_USER, AUDIT_EVENTS } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import AuditPage from './AuditPage';

/**
 * The audit trail page.
 *
 * The assertion that matters most here is the negative one: a delivery-settings
 * entry must show *which* fields changed and never their values. The server is what
 * guarantees that — it records field names only — but this page renders whatever it
 * is sent, so a regression on either side would put a webhook URL or an SMTP
 * password onto a screen, in a record that cannot be pruned.
 */

/** Signs in as a plain user instead of the default admin. */
function asNonAdmin() {
  server.use(http.get('/auth/me', () => HttpResponse.json({ ...ADMIN_USER, role: 'USER' })));
}

async function renderAudit() {
  const result = renderApp(<AuditPage />, { authenticated: true });
  await waitFor(() => expect(screen.getByText(/deleted a finding/i)).toBeInTheDocument(), {
    timeout: 10_000,
  });
  return result;
}

describe('AuditPage', () => {
  it('says who did what, and to which thing', async () => {
    await renderAudit();

    // Two of the three entries are that account, so plural: the singular query
    // throws on more than one match.
    expect(screen.getAllByText('admin@example.com')).toHaveLength(2);
    expect(screen.getByText('user:9')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    // The raw action is shown under the label, because the label is for reading and
    // the action is what someone filters or greps for.
    expect(screen.getByText('alert.delete')).toBeInTheDocument();
  });

  it('keeps the description of a deleted finding', async () => {
    // The point of recording kind, severity and title rather than just an id: once
    // the alert row is gone, this entry is the only surviving account of it.
    await renderAudit();

    expect(screen.getByText(/Port scan from 10\.0\.0\.90/)).toBeInTheDocument();
    expect(screen.getByText(/port_scan/)).toBeInTheDocument();
  });

  it('shows which delivery fields changed and not their values', async () => {
    /*
     * `webhookUrl` and `emailPassword` are credentials. The fixture carries
     * their names, as the server sends them; if a value ever appeared in `detail`
     * this assertion is what notices, on the screen where it would be read.
     */
    await renderAudit();

    expect(screen.getByText(/webhookUrl/)).toBeInTheDocument();
    expect(screen.getByText(/emailPassword/)).toBeInTheDocument();

    // Nothing that looks like a secret's value, anywhere on the page.
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/hooks\.slack\.com|xoxb-|password=/i);
  });

  it('reports a bulk clear as a count rather than a list', async () => {
    // A thousand titles in a table that cannot be pruned would be a different
    // mistake, so the entry carries counts.
    await renderAudit();

    expect(screen.getByText(/1204/)).toBeInTheDocument();
  });

  it('asks the server for the action being filtered on', async () => {
    const asked: string[] = [];
    server.use(
      http.get('/api/audit', ({ request }) => {
        const action = new URL(request.url).searchParams.get('action');
        if (action) asked.push(action);
        // Unfiltered means everything, as the real endpoint does — the first
        // version of this handler returned nothing when no filter was set, so the
        // page never rendered and the test failed before it got as far as filtering.
        return HttpResponse.json({
          events: action ? AUDIT_EVENTS.filter((event) => event.action === action) : AUDIT_EVENTS,
        });
      }),
    );

    const user = userEvent.setup();
    await renderAudit();

    // Filtering server-side, not in the browser: the page only ever holds one page
    // of a table that grows for ever, so filtering here would describe a subset.
    await user.click(screen.getByRole('combobox', { name: /filter by action/i }));
    await user.click(await screen.findByRole('option', { name: /cleared every finding/i }));

    await waitFor(() => expect(asked).toContain('alerts.clear'));
  });

  it('offers to load older entries only when there are some', async () => {
    // The server answers with a cursor when a further page exists and omits it on
    // the last one, so the button follows the cursor rather than guessing from the
    // row count.
    await renderAudit();
    expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument();

    server.use(
      http.get('/api/audit', () =>
        HttpResponse.json({ events: AUDIT_EVENTS, nextBefore: '2026-09-02T18:00:00.000Z' }),
      ),
    );
    renderApp(<AuditPage />, { authenticated: true });

    expect(await screen.findByRole('button', { name: /load older/i })).toBeInTheDocument();
  });

  it('explains an empty trail rather than looking broken', async () => {
    // A blank table reads as a failure. An installation where nothing has been
    // deleted yet is the normal, good state and should say so.
    server.use(http.get('/api/audit', () => HttpResponse.json({ events: [] })));
    renderApp(<AuditPage />, { authenticated: true });

    expect(
      await screen.findByText(/Nothing has been deleted, changed or redirected yet/i),
    ).toBeInTheDocument();
  });

  it('reports a load failure instead of an empty trail', async () => {
    // "No entries" and "could not read the entries" must not look the same on a
    // page whose whole purpose is accountability.
    server.use(
      http.get('/api/audit', () => HttpResponse.json({ message: 'Database is down' }, { status: 500 })),
    );
    renderApp(<AuditPage />, { authenticated: true });

    // The server's own message, not the fallback: `describeError` prefers it, and
    // an operator needs to know *why* the record could not be read.
    expect(await screen.findByText(/database is down/i, {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('tells a non-admin why the page is empty for them', async () => {
    // The server refuses the route and the nav entry is hidden, so this is only
    // reachable by a pasted URL — where an explanation beats a failed fetch.
    asNonAdmin();
    renderApp(<AuditPage />, { authenticated: true });

    expect(await screen.findByText(/visible to administrators/i)).toBeInTheDocument();
    expect(screen.queryByText('alert.delete')).not.toBeInTheDocument();
  });
});
