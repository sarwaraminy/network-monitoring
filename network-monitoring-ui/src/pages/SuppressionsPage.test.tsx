import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_USER, SUPPRESSION_PREVIEW } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import SuppressionsPage from './SuppressionsPage';

/**
 * The suppression page.
 *
 * A suppressed finding is dropped rather than hidden, so there is no "show
 * suppressed" view to fall back on and no way to discover after the fact that a
 * rule was too broad. Everything asserted here is therefore about the page making
 * that cost visible: what each rule covers, how much it has hidden, which rules
 * are in force, and — the worst state available — which rules look like coverage
 * while matching nothing at all.
 */

/** Signs in as a plain user instead of the default admin. */
function asNonAdmin() {
  server.use(http.get('/auth/me', () => HttpResponse.json({ ...ADMIN_USER, role: 'USER' })));
}

describe('SuppressionsPage', () => {
  it('says plainly that a matching finding is dropped, not hidden', async () => {
    // The one thing an operator must understand before writing a rule. Nothing
    // downstream — the alert list, the webhook, the SIEM feed — ever sees it.
    renderApp(<SuppressionsPage />, { authenticated: true });

    expect(await screen.findByText(/dropped before it is stored/i)).toBeInTheDocument();
  });

  it('describes what each rule covers in one line', async () => {
    renderApp(<SuppressionsPage />, { authenticated: true });

    // Criteria are a conjunction, and reading them out is how an operator checks
    // a rule is narrower than they feared.
    expect(await screen.findByText('Port scan from 10.20.30.0/24')).toBeInTheDocument();
    expect(screen.getByText('Host sweep on port 445')).toBeInTheDocument();
    expect(screen.getByText('Any finding from 192.168.50.10/32')).toBeInTheDocument();
  });

  it('shows how much has been hidden, since that is the only trace left', async () => {
    renderApp(<SuppressionsPage />, { authenticated: true });

    // 4,820 + 311 across the fixture. A headline number rather than a column,
    // because a rule quietly eating thousands a day should not need looking for.
    expect(await screen.findByText('5,131')).toBeInTheDocument();
    expect(screen.getByText('dropped before storage, all time')).toBeInTheDocument();
  });

  it('calls out a rule the server cannot use, with the reason', async () => {
    // The state that looks like coverage and is not: its author believes findings
    // are being suppressed and none are.
    renderApp(<SuppressionsPage />, { authenticated: true });

    // Named with its reason, not counted. "1 rule is invalid" sends the operator
    // hunting through the table for it, and says nothing about what to fix.
    const banner = await screen.findByText(/cannot match anything/i);
    expect(banner).toHaveTextContent('#4');
    expect(banner).toHaveTextContent('is not an address or CIDR range');
    expect(screen.getByText('Invalid')).toBeInTheDocument();
  });

  it('distinguishes a lapsed rule from one switched off', async () => {
    // Both stop suppressing, and the reasons are different: one needs extending,
    // the other was a deliberate act.
    renderApp(<SuppressionsPage />, { authenticated: true });

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('no longer suppressing')).toBeInTheDocument();
  });

  it('flags a rule that is in force and has hidden nothing', async () => {
    // Either the range is wrong or the noise stopped. Both are worth knowing, and
    // neither is visible from a count of zero on its own.
    renderApp(<SuppressionsPage />, { authenticated: true });

    expect(await screen.findByText('Never matched')).toBeInTheDocument();
    expect(screen.getByText('in force but has hidden nothing')).toBeInTheDocument();
  });

  it('offers editing only to an administrator', async () => {
    // The rule list stays readable by anyone who can read the alerts — a
    // suppression nobody can audit is worse than one anybody can see — but writing
    // one can make the tool go quiet, so it is ADMIN-only. The server enforces
    // this independently; the UI only stops offering a control it would refuse.
    asNonAdmin();
    renderApp(<SuppressionsPage />, { authenticated: true });

    expect(await screen.findByText('Port scan from 10.20.30.0/24')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new rule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit rule 1/i })).not.toBeInTheDocument();
  });

  it('will not save a rule with no criteria', async () => {
    // Such a rule would drop every finding on the network. The server refuses it
    // and so does a CHECK constraint; the form refuses it before anyone types a
    // reason and gets told off afterwards.
    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText(/why is this expected/i), 'no criteria at all');
    expect(within(dialog).getByRole('button', { name: /create rule/i })).toBeDisabled();
  });

  it('creates a rule and reports that it is already in force', async () => {
    // "Created" is not the useful part — a rule that takes effect at some point in
    // the next half-minute would have the operator watching suppressed findings
    // keep arriving and concluding the feature is broken.
    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText(/source address or range/i), '10.99.0.0/24');
    await user.type(within(dialog).getByLabelText(/why is this expected/i), 'Authorised scanner, OPS-2');
    await user.click(within(dialog).getByRole('button', { name: /create rule/i }));

    expect(await screen.findByText(/created and in force/i)).toBeInTheDocument();
  });

  it('shows the server’s own message when a range is refused', async () => {
    // The message names the field and says how to write a range, which is the
    // difference between an operator fixing a typo and concluding it does not work.
    server.use(
      http.post('/api/suppressions', () =>
        HttpResponse.json(
          {
            message:
              'must be an IP address or CIDR range, e.g. 10.0.0.7 or 10.0.0.0/24. ' +
              'A /0 range is not accepted: leave the field empty to match any address.',
          },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText(/source address or range/i), '0.0.0.0/0');
    await user.type(within(dialog).getByLabelText(/why is this expected/i), 'everything, surely fine');
    await user.click(within(dialog).getByRole('button', { name: /create rule/i }));

    expect(await screen.findByText(/A \/0 range is not accepted/i)).toBeInTheDocument();
  });

  it('measures a draft rule against real alerts before it is saved', async () => {
    // Authoring a suppression is a guess about a range, and the cost of guessing
    // wide is silence rather than an error. The observation count is the number
    // that matters: two alerts here carry 4,821 observations between them.
    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText(/source address or range/i), '10.20.30.0/24');
    await user.click(within(dialog).getByRole('button', { name: /check against recent alerts/i }));

    expect(await screen.findByText(/4,821 observations in total/i)).toBeInTheDocument();
    expect(screen.getByText(/would have hidden 2 of the last 500 alerts/i)).toBeInTheDocument();
  });

  it('warns rather than reassures when a draft rule matches nothing', async () => {
    // "0 matched" is the shape of a mistyped range far more often than it is the
    // shape of a rule that is ready.
    server.use(
      http.post('/api/suppressions/preview', () =>
        HttpResponse.json({ ...SUPPRESSION_PREVIEW, matched: 0, occurrences: 0, samples: [] }),
      ),
    );

    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText(/source address or range/i), '10.20.30.0/24');
    await user.click(within(dialog).getByRole('button', { name: /check against recent alerts/i }));

    const notice = await screen.findByText(/Nothing among the last 500 alerts matches this rule/i);
    expect(notice).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveClass(/colorWarning|standardWarning/);
  });

  it('says what switching a rule off will do', async () => {
    // The consequence, not the fact. "Rule updated" leaves the operator to work
    // out whether the noise is coming back.
    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /disable rule 1/i }));
    expect(await screen.findByText(/will be stored again/i)).toBeInTheDocument();
  });

  it('warns that deleting discards the record of what a rule hid', async () => {
    // Deliberately a confirm rather than an undo: the match count is the only
    // evidence of what the rule was doing, and it goes with the row.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderApp(<SuppressionsPage />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /delete rule 1/i }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('4,820 hidden findings'));
    expect(await screen.findByText('Rule deleted.')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('reports a listing failure instead of rendering an empty page', async () => {
    // An empty rule table means "nothing is being suppressed", which is a
    // dangerous thing to say when the truth is "we could not ask".
    server.use(http.get('/api/suppressions', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderApp(<SuppressionsPage />, { authenticated: true });
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });
});
