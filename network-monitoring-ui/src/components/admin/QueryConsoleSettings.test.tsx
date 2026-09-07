import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADHOC_SETTINGS } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import QueryConsoleSettings from './QueryConsoleSettings';

/**
 * The query console's settings, from the administrator's side.
 *
 * The layering is what these tests are about: **environment → stored row →
 * default, and the environment wins.** The resolver's own tests cover which
 * value applies; these cover the half the resolver cannot enforce — that the
 * form does not offer a control for a decision already made in the environment,
 * and says which variable made it.
 *
 * A control that silently does nothing is this codebase's recurring bug, and
 * here it would be worse than cosmetic: the field it would lie about is the one
 * that decides whether a browser can run SQL against the production database.
 */

type Settings = typeof ADHOC_SETTINGS;

const settings = (body: Partial<Settings> | Settings) =>
  server.use(http.get('/api/adhoc/settings', () => HttpResponse.json({ ...ADHOC_SETTINGS, ...body })));

/** Pins one field to the environment, as a deployment's Compose file would. */
const pinned = (field: keyof Settings['settings'], value: boolean | number | string) =>
  settings({
    settings: {
      ...ADHOC_SETTINGS.settings,
      [field]: { ...ADHOC_SETTINGS.settings[field], value, source: 'environment' },
    },
  });

/** Captures the body of the save, so a test can assert what was actually sent. */
function capture() {
  const sent: Record<string, unknown>[] = [];
  server.use(
    http.put('/api/adhoc/settings', async ({ request }) => {
      sent.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ effective: ADHOC_SETTINGS.effective });
    }),
  );
  return sent;
}

describe('editing the settings', () => {
  it('turns the console on without a restart', async () => {
    // The feature, in one test. Previously this meant editing a Compose file and
    // restarting the API, which on a monitoring server drops a live capture.
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await user.click(await screen.findByRole('switch', { name: 'Query console' }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ enabled: true });
    expect(await screen.findByText(/no restart needed/i)).toBeInTheDocument();
  });

  it('sends only the fields that moved', async () => {
    /*
     * Not tidiness. A patch carrying every field would write a row for settings
     * the administrator never touched, and each written value then outranks the
     * environment variable that had been supplying it — so an unrelated save
     * would quietly freeze the whole configuration at whatever the form last
     * displayed.
     */
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const rowCap = await screen.findByLabelText('Row cap');
    await user.clear(rowCap);
    await user.type(rowCap, '50');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ maxRows: 50 });
  });

  it('has nothing to save until something changes', async () => {
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    expect(await screen.findByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
  });

  it('counts what is waiting to be saved', async () => {
    const user = userEvent.setup();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await user.click(await screen.findByRole('switch', { name: 'Query console' }));
    await user.click(screen.getByRole('switch', { name: 'Allow writes' }));

    expect(screen.getByText('2 unsaved')).toBeInTheDocument();
  });
});

describe('a field the environment has pinned', () => {
  it('is shown, disabled, with the variable that pinned it', async () => {
    /*
     * Shown rather than hidden: an administrator who cannot find the switch
     * assumes the page is broken, while a disabled one naming `ADHOC_ENABLED`
     * tells them exactly where the decision lives and who can change it.
     */
    pinned('enabled', true);
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const control = await screen.findByRole('switch', { name: 'Query console' });
    expect(control).toBeDisabled();
    expect(control).toBeChecked();
    expect(screen.getAllByText('ADHOC_ENABLED').length).toBeGreaterThan(0);
    expect(screen.getByText(/remove that line and restart/i)).toBeInTheDocument();
  });

  it('leaves the other fields editable', async () => {
    // A pin is per field. Disabling the form because one variable is set would
    // make an installation that pins `ADHOC_ENABLED=true` — the sensible thing to
    // pin — unable to tune any limit.
    pinned('enabled', true);
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    expect(await screen.findByLabelText('Row cap')).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Allow writes' })).toBeEnabled();
  });

  it('surfaces the server refusing a pinned field, naming the variable', async () => {
    /*
     * The race the disabled control cannot cover: a variable added to the
     * environment and the API restarted between this form loading and Save being
     * pressed. The server refuses with a 409, and the message has to reach the
     * reader — a save that silently did nothing is how somebody concludes the
     * setting is stored and moves on.
     */
    const user = userEvent.setup();
    server.use(
      http.put('/api/adhoc/settings', () =>
        HttpResponse.json(
          {
            message:
              'Set in the environment and cannot be changed here: ADHOC_MAX_ROWS. ' +
              'Remove the variable and restart the API to manage it from this page.',
          },
          { status: 409 },
        ),
      ),
    );
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const rowCap = await screen.findByLabelText('Row cap');
    await user.clear(rowCap);
    await user.type(rowCap, '50');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/ADHOC_MAX_ROWS/)).toBeInTheDocument();
  });
});

describe('the password that stays in the environment', () => {
  it('warns that the switches are inert without one', async () => {
    /*
     * `ADHOC_DB_PASSWORD` is installed on a Postgres role at boot and is
     * deliberately not editable here — it is what keeps the decision to *have* a
     * SQL prompt on the production database with whoever installed the server.
     * The consequence needs saying: with the password missing, turning the
     * console on changes nothing, and an administrator watching nothing happen
     * deserves the reason rather than a guess.
     */
    settings({ passwordConfigured: false });
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    expect(await screen.findByText(/no console password is set/i)).toBeInTheDocument();
    expect(screen.getByText('ADHOC_DB_PASSWORD')).toBeInTheDocument();
  });

  it('says nothing when one is set', async () => {
    // A standing warning on a healthy install is noise, and noise is what makes
    // the real one unreadable.
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await screen.findByRole('switch', { name: 'Query console' });
    expect(screen.queryByText(/no console password is set/i)).not.toBeInTheDocument();
  });

  it('offers no field for it', async () => {
    /*
     * Guarding the design rather than the code, and the mirror of the resolver's
     * own assertion. Adding a password box here is the obvious next
     * "improvement": it would put a credential in a request body, in the audit
     * detail if anybody logged the patch, and hand the decision to any admin
     * session.
     */
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await screen.findByRole('switch', { name: 'Query console' });
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('when the server will not say', () => {
  it('reports the failure instead of an empty form', async () => {
    // An empty form reads as "nothing is configured", which for these fields is a
    // dangerous thing to imply — `enabled` would appear to be off.
    server.use(
      http.get('/api/adhoc/settings', () => HttpResponse.json({ message: 'Nope' }, { status: 500 })),
    );
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    expect(await screen.findByText(/nope/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Query console' })).not.toBeInTheDocument();
  });
});
