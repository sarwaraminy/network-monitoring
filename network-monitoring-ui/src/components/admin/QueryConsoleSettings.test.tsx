import { screen, waitFor, within } from '@testing-library/react';
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

  it('clears a number back to the environment or the default', async () => {
    /*
     * `null` is how this API and V14 spell "stop deciding this here". It was
     * unreachable from the form: the number input stored `Number(value)`, and
     * `Number('')` is `0` — so emptying the box stored a zero, the field snapped
     * to `0` while you were still editing, and Save returned a 400 against the
     * schema's `min` bound. The nullable column was usable from the migration,
     * the schema and the route, and from nowhere in the only interface that
     * reaches them.
     */
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const rowCap = await screen.findByLabelText('Row cap');
    await user.clear(rowCap);

    // Stays empty rather than showing 0 — the state that made this look like a
    // display glitch instead of an unsendable value.
    expect(rowCap).toHaveValue(null);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ maxRows: null });
  });

  it('still sends a typed zero as a zero, not as a clear', async () => {
    /*
     * The other side of the same distinction, and the reason the draft keeps raw
     * text: an emptied box and a typed `0` must not collapse into one value. The
     * server refuses zero against V14's `BETWEEN 1 AND 100000`, which is correct
     * and is a different answer from "unset".
     */
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const rowCap = await screen.findByLabelText('Row cap');
    await user.clear(rowCap);
    await user.type(rowCap, '0');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ maxRows: 0 });
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

describe('the console role password', () => {
  /*
   * It used to be environment-only, and the form's job was to explain that.
   * Since V15 it is settable here, and the form's job is to be the remedy the
   * warning points at — the old text ended with "set it in the environment and
   * restart the API", which an administrator without server access could do
   * nothing with.
   *
   * It still behaves unlike every other field, because the server never returns
   * it: an empty box means "leave it alone", and clearing is a separate button.
   * That distinction is what these cases are mostly about, since getting it
   * wrong stops the console by accident.
   */

  const noPassword = () =>
    settings({
      passwordConfigured: false,
      settings: {
        ...ADHOC_SETTINGS.settings,
        dbPassword: { ...ADHOC_SETTINGS.settings.dbPassword, configured: false },
      },
    });

  it('offers a field for it, and never shows a value in it', async () => {
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const field = await screen.findByLabelText('Console role password');
    expect(field).toHaveAttribute('type', 'password');
    // Nothing to prefill: the server reports `configured`, not the credential.
    // A form that echoed it back would put the password in the DOM of every
    // administrator's browser for the sake of showing dots.
    expect(field).toHaveValue('');
    expect(screen.getByPlaceholderText(/leave blank to keep it/i)).toBeInTheDocument();
  });

  it('sends nothing when the box is left empty', async () => {
    /*
     * The accident this design exists to prevent. Typing into the field and
     * deleting it again would otherwise submit an empty string, which the
     * resolver reads as unset — silently clearing the credential and stopping
     * the console because the reader changed their mind about editing it.
     */
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const field = await screen.findByLabelText('Console role password');
    await user.type(field, 'abc');
    await user.clear(field);

    // Nothing to save: the empty box is not a change.
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();

    // And a real change alongside it does not drag the password along.
    await user.click(screen.getByRole('switch', { name: 'Query console' }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ enabled: true });
  });

  it('sends a password that was typed', async () => {
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await user.type(await screen.findByLabelText('Console role password'), 'a-real-one-9F3a');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ dbPassword: 'a-real-one-9F3a' });
  });

  it('clears it only through its own button, and says what that will do', async () => {
    // Separate control, so the destructive reading of an empty field is never
    // the one that happens by accident. And the consequence is stated, because
    // the console stops the moment its credential goes.
    const user = userEvent.setup();
    const sent = capture();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /clear password/i }));
    expect(screen.getByText(/will be cleared on save/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ dbPassword: null });
  });

  it('offers nothing to clear when there is nothing set', async () => {
    noPassword();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await screen.findByLabelText('Console role password');
    expect(screen.queryByRole('button', { name: /clear password/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/not set/i)).toBeInTheDocument();
  });

  it('warns that the switches are inert, and points at the field rather than a file', async () => {
    /*
     * Without a password the console cannot start whatever else is set, so an
     * administrator turning it on and watching nothing happen deserves the
     * reason. The remedy has to be reachable from where they are standing.
     */
    noPassword();
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent(/no console password is set/i);
    // Scoped to the warning: the field's own label says the same words, and a
    // page-wide query would pass on the label while the warning said nothing.
    expect(within(warning).getByText('Console role password')).toBeInTheDocument();
    // The old dead end, which told a reader with no server access to edit a file
    // and restart the API.
    expect(warning).not.toHaveTextContent(/restart the API/i);
  });

  it('sends somebody to the environment when the variable is the one that pinned it', async () => {
    // The one case where the file really is the answer: `ADHOC_DB_PASSWORD` set
    // but empty pins the field, so nothing typed here could take effect.
    settings({
      passwordConfigured: false,
      settings: {
        ...ADHOC_SETTINGS.settings,
        dbPassword: {
          source: 'environment' as Settings['settings']['dbPassword']['source'],
          env: 'ADHOC_DB_PASSWORD',
          configured: false,
        },
      },
    });
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    expect(await screen.findByText(/no console password is set/i)).toBeInTheDocument();
    expect(screen.getAllByText('ADHOC_DB_PASSWORD').length).toBeGreaterThan(0);
    expect(await screen.findByLabelText('Console role password')).toBeDisabled();
  });

  it('says nothing when one is set', async () => {
    // A standing warning on a healthy install is noise, and noise is what makes
    // the real one unreadable.
    renderApp(<QueryConsoleSettings />, { authenticated: true });

    await screen.findByRole('switch', { name: 'Query console' });
    expect(screen.queryByText(/no console password is set/i)).not.toBeInTheDocument();
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
