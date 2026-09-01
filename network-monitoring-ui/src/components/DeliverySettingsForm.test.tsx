import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { DELIVERY_SETTINGS } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import DeliverySettingsForm from './DeliverySettingsForm';

/**
 * The delivery settings form.
 *
 * Every value here used to require editing a file on the host and restarting, which
 * made each tuning change an outage. What is asserted is the three ways this form
 * could mislead the person using it:
 *
 *  1. A field pinned in the environment must be visibly uneditable. The API refuses
 *     to store a change to it, so an editable control would accept an edit and change
 *     nothing — and the conclusion drawn would be "the settings page is broken".
 *  2. A secret must never be displayed, only replaced. The API does not send it.
 *  3. A save must send only what changed, so it cannot silently rewrite the
 *     twenty-three fields it did not touch.
 */

describe('DeliverySettingsForm', () => {
  it('shows the current values, grouped by what they affect', async () => {
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    expect(await screen.findByText('Gates')).toBeInTheDocument();
    expect(screen.getByText('Webhook')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Syslog / SIEM')).toBeInTheDocument();

    expect(screen.getByLabelText(/collector host/i)).toHaveValue('siem.internal');
    expect(screen.getByLabelText(/dashboard link/i)).toHaveValue('https://nmt.example.test/alerts');
  });

  it('disables a field the environment pins and names the variable', async () => {
    // The whole reason the API reports provenance. `enabled` is pinned in the
    // fixture, so the switch must be visibly not-yours-to-change rather than a
    // control that accepts a click and does nothing.
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    const toggle = await screen.findByLabelText('Deliver alerts');
    expect(toggle).toBeDisabled();
    expect(screen.getByText('NOTIFY_ENABLED')).toBeInTheDocument();
    expect(screen.getByText(/set in the environment and cannot be changed here/i)).toBeInTheDocument();
  });

  it('never shows a secret, and says whether one is set', async () => {
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    const webhook = await screen.findByLabelText(/webhook url/i);
    // Configured in the fixture, and still empty on screen: the API sends no value,
    // and an empty box means "leave it alone".
    expect(webhook).toHaveValue('');
    expect(webhook).toHaveAttribute('placeholder', expect.stringMatching(/type to replace/i));
    expect(screen.getAllByText('Configured').length).toBeGreaterThan(0);
    // The SMTP password is not configured in the fixture, so it must not claim to be.
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
  });

  it('cannot be saved until something changes', async () => {
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    const save = await screen.findByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');

    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
    expect(screen.getByText(/1 unsaved/i)).toBeInTheDocument();
  });

  it('sends only the fields that changed', async () => {
    // A save that posted all twenty-four would rewrite fields nobody touched, and
    // would have to round-trip a secret the API never sent it.
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/notify/settings', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/max messages per hour/i));
    await user.type(screen.getByLabelText(/max messages per hour/i), '4');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ maxPerHour: 4 });
  });

  it('does not send a field that was typed in and then put back', async () => {
    // The property that separates "only what changed" from "whatever was touched".
    // Without it the form posts a field whose value is identical to the stored one,
    // which is harmless in isolation and wrong as a claim — and it is what a
    // bypassed dirty check looks like.
    //
    // Added after proving the point: replacing `changedFields` with
    // `Object.keys(draft)` passed every other test in this file.
    let calls = 0;
    server.use(
      http.put('/api/notify/settings', () => {
        calls += 1;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    const appName = await screen.findByLabelText(/app name/i);
    await user.clear(appName);
    await user.type(appName, 'sensor-1');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();

    // Back to what the server sent.
    await user.clear(appName);
    await user.type(appName, 'nmt');

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it('does not send a field the environment pins, even if one were edited', async () => {
    // Belt and braces against the 409: the control is disabled, and the patch
    // builder filters pinned keys too.
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/notify/settings', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(Object.keys(body ?? {})).not.toContain('enabled');
  });

  it('clears a text field to null rather than to an empty string', async () => {
    // Null is how "fall back to the environment or the default" is expressed. An
    // empty string would store a deliberate blank, which is a different thing.
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/notify/settings', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/collector host/i));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ syslogHost: null });
  });

  it('says the change is already in force, because that is the point', async () => {
    // The old answer to "I changed a setting" was "now restart the service".
    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/already in force/i)).toBeInTheDocument();
  });

  it('shows the server’s own refusal verbatim', async () => {
    // The server names the pinned field, or the bound a number missed. Replacing
    // that with "could not save" throws away the only useful part.
    server.use(
      http.put('/api/notify/settings', () =>
        HttpResponse.json(
          {
            message:
              'Set in the environment and not editable here: enabled. Remove the variable from api/.env to manage it from this page.',
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/not editable here: enabled/i)).toBeInTheDocument();
  });

  it('discards edits without saving them', async () => {
    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');
    expect(screen.getByLabelText(/app name/i)).toHaveValue('sensor-1');

    await user.click(screen.getByRole('button', { name: /discard/i }));
    expect(screen.getByLabelText(/app name/i)).toHaveValue('nmt');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('reports a read failure instead of an empty form', async () => {
    server.use(
      http.get('/api/notify/settings', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    );

    renderApp(<DeliverySettingsForm />, { authenticated: true });
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });

  it('offers recipients as a list, not a comma-separated string', async () => {
    // Stored as an array so a recipient containing a comma cannot corrupt the set.
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/notify/settings', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.type(await screen.findByLabelText(/recipients/i), 'ops@example.test, oncall@example.test');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ emailTo: ['ops@example.test', 'oncall@example.test'] });
  });

  it('clearing a secret does not discard an unrelated unsaved edit', async () => {
    // clearSecret fires its own save, immediately, separately from the Save
    // changes button. Its success must only claim the field it actually sent —
    // not silently drop whatever else was sitting typed-but-unsaved in the form.
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/notify/settings', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');
    expect(screen.getByText(/1 unsaved/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ webhookUrl: null });
    // The unrelated edit is still there, and still marked unsaved — not wiped by
    // a success message that belongs to the webhook field alone.
    expect(screen.getByLabelText(/app name/i)).toHaveValue('sensor-1');
    expect(screen.getByText(/1 unsaved/i)).toBeInTheDocument();
  });

  it('explains why nothing was saved when every changed field turned out to be pinned', async () => {
    // Reachable without a real race: a background refetch (a window focus, a
    // poll) can mark a field pinned between typing into it and clicking Save.
    // Silently doing nothing would look identical to the request having hung —
    // the button stays enabled and "1 unsaved" keeps showing.
    let putCalled = false;
    server.use(
      http.put('/api/notify/settings', () => {
        putCalled = true;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    const { client } = renderApp(<DeliverySettingsForm />, { authenticated: true });

    await user.clear(await screen.findByLabelText(/app name/i));
    await user.type(screen.getByLabelText(/app name/i), 'sensor-1');
    expect(screen.getByText(/1 unsaved/i)).toBeInTheDocument();

    // Stands in for the field becoming pinned mid-edit, as a real refetch would.
    client.setQueryData(['notify', 'settings'], {
      ...DELIVERY_SETTINGS,
      pinnedByEnvironment: [...DELIVERY_SETTINGS.pinnedByEnvironment, 'syslogAppName'],
    });
    await screen.findByText('SYSLOG_APP_NAME');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/every changed field is now set in the environment/i)).toBeInTheDocument();
    expect(putCalled).toBe(false);
  });

  it('clears recipients to null rather than an empty list, so the environment can take over again', async () => {
    // An empty list is a different, explicit statement from "unset" — permanently
    // no recipients, rather than falling back to whatever NOTIFY_EMAIL_TO says.
    // Every other field kind already maps an emptied box to null; this is the
    // same contract for the one field kind that is a list rather than a scalar.
    server.use(
      http.get('/api/notify/settings', () =>
        HttpResponse.json({
          ...DELIVERY_SETTINGS,
          settings: {
            ...DELIVERY_SETTINGS.settings,
            emailTo: { source: 'database', value: ['ops@example.test'] },
          },
        }),
      ),
    );

    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/notify/settings', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(DELIVERY_SETTINGS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<DeliverySettingsForm />, { authenticated: true });

    const recipients = await screen.findByLabelText(/recipients/i);
    expect(recipients).toHaveValue('ops@example.test');
    await user.clear(recipients);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ emailTo: null });
  });
});
