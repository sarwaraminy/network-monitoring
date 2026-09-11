import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { IDLE_STATUS, RUNNING_STATUS } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import PacketCapture from './PacketCapture';
import PacketCaptureWithIP from './PacketCaptureWithIP';

/**
 * The capture pages.
 *
 * Two behaviours here previously broke in ways a build could not catch: `POST
 * /start` sent a `null` body that Express rejected with a 400 (only reproducible
 * through the browser), and a failed start used to report success, leaving the UI
 * claiming to capture with nothing arriving.
 */

describe('PacketCapture', () => {
  it('loads the interface list into the dropdown', async () => {
    const user = userEvent.setup();
    renderApp(<PacketCapture />, { authenticated: true });

    const select = await screen.findByRole('combobox', { name: /network interface/i }, { timeout: 10_000 });
    await user.click(select);

    expect(
      await screen.findByRole('option', { name: /Intel\(R\) Ethernet Connection/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /loopback/i })).toBeInTheDocument();
  });

  it('sends the start request with parameters as query arguments and no null body', async () => {
    const seen: { search: string; body: string }[] = [];
    server.use(
      http.post('*/packets/start', async ({ request }) => {
        seen.push({ search: new URL(request.url).search, body: await request.text() });
        return HttpResponse.json(RUNNING_STATUS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<PacketCapture />, { authenticated: true });

    const select = await screen.findByRole('combobox', { name: /network interface/i }, { timeout: 10_000 });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: /Intel\(R\) Ethernet/i }));
    await user.click(screen.getByRole('button', { name: /start capture/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.search).toContain('interfaceName=');
    expect(seen[0]!.search).toContain('snaplength=65536');
    // The regression: axios serialises a null body to the string "null", which
    // express.json() rejects in strict mode.
    expect(seen[0]!.body).not.toBe('null');
    expect(seen[0]!.body).toBe('');
  });

  it('keeps Start disabled until an interface is chosen', async () => {
    renderApp(<PacketCapture />, { authenticated: true });
    const start = await screen.findByRole('button', { name: /start capture/i }, { timeout: 10_000 });
    expect(start).toBeDisabled();
  });

  it('reports a failed start instead of claiming to be capturing', async () => {
    server.use(
      http.post('*/packets/start', () =>
        HttpResponse.json({ message: 'Could not open the interface: permission denied' }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderApp(<PacketCapture />, { authenticated: true });

    const select = await screen.findByRole('combobox', { name: /network interface/i }, { timeout: 10_000 });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: /Intel\(R\) Ethernet/i }));
    await user.click(screen.getByRole('button', { name: /start capture/i }));

    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
    expect(screen.getByText(/^Idle$/)).toBeInTheDocument();
  });

  it('reflects a capture already running when the page mounts', async () => {
    server.use(http.get('*/packets/status', () => HttpResponse.json(RUNNING_STATUS)));

    renderApp(<PacketCapture />, { authenticated: true });

    // Reloading mid-capture must show the real state, not reset to idle.
    expect(await screen.findByText(/^Capturing$/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/Link: ETHERNET/)).toBeInTheDocument();
    expect(screen.getByText(/2 findings/)).toBeInTheDocument();
  });

  it('warns when the server has no capture library', async () => {
    server.use(
      http.get('*/packets/status', () =>
        HttpResponse.json({ ...IDLE_STATUS, captureAvailable: false, captureLibrary: null }),
      ),
    );

    renderApp(<PacketCapture />, { authenticated: true });
    expect(
      await screen.findByText(/packet capture library could not be loaded/i, {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('renders captured packets in the table', async () => {
    server.use(http.get('*/packets/status', () => HttpResponse.json(RUNNING_STATUS)));

    renderApp(<PacketCapture />, { authenticated: true });
    expect(await screen.findByText('10.0.0.89', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText('52.98.50.18')).toBeInTheDocument();
    expect(screen.getByText('0x0800 (IPv4)')).toBeInTheDocument();
  });
});

describe('PacketCaptureWithIP', () => {
  it('requires a filter address before Start is enabled', async () => {
    const user = userEvent.setup();
    renderApp(<PacketCaptureWithIP />, { authenticated: true });

    const select = await screen.findByRole('combobox', { name: /network interface/i }, { timeout: 10_000 });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: /Intel\(R\) Ethernet/i }));

    // Interface chosen but no IP yet.
    expect(screen.getByRole('button', { name: /start capture/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/filter by ip address/i), '10.0.0.5');
    expect(screen.getByRole('button', { name: /start capture/i })).toBeEnabled();
  });

  it('passes the filter address to the server', async () => {
    let search = '';
    server.use(
      http.post('*/ip/packets/start', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(RUNNING_STATUS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<PacketCaptureWithIP />, { authenticated: true });

    const select = await screen.findByRole('combobox', { name: /network interface/i }, { timeout: 10_000 });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: /Intel\(R\) Ethernet/i }));
    await user.type(screen.getByLabelText(/filter by ip address/i), '10.0.0.5');
    await user.click(screen.getByRole('button', { name: /start capture/i }));

    await waitFor(() => expect(search).toContain('ipAddress=10.0.0.5'));
  });
});

/**
 * What the screen says after a restart.
 *
 * Capture lives in process memory, so a restart leaves it off — and the status
 * chip reads "Idle", which is equally true of a host that has never captured
 * anything and one that was capturing until the service restarted at 03:14. For a
 * monitoring product a gap in monitoring that nothing reports is the worst state
 * it can be in, because it looks exactly like the good one.
 *
 * Driven through the page rather than the component, because the value comes from
 * the status endpoint and the point is that it reaches the screen.
 */
describe('a capture that did not stop cleanly', () => {
  const INTERRUPTED = {
    ...IDLE_STATUS,
    interrupted: {
      interfaceName: 'eth0',
      filterIp: null,
      snapshotLength: 65_535,
      timeoutMs: 1000,
      startedAt: '2026-09-09T03:14:00.000Z',
      startedBy: 'alice@example.com',
    },
  };

  it('says what was running instead of only "Idle"', async () => {
    server.use(http.get('*/packets/status', () => HttpResponse.json(INTERRUPTED)));
    renderApp(<PacketCapture />, { authenticated: true });

    const note = await screen.findByText(/stopped unexpectedly/i, undefined, {
      timeout: 10_000,
    });
    expect(note).toBeInTheDocument();
    // Which interface and whose capture, so the reader knows what to restart.
    expect(note).toHaveTextContent('eth0');
    expect(note).toHaveTextContent('alice@example.com');
  });

  it('offers to run it again on the settings it was started with', async () => {
    const started: Array<Record<string, string | null>> = [];
    server.use(
      http.get('*/packets/status', () => HttpResponse.json(INTERRUPTED)),
      http.post('*/packets/start', ({ request }) => {
        const url = new URL(request.url);
        started.push(Object.fromEntries(url.searchParams));
        return HttpResponse.json(RUNNING_STATUS);
      }),
    );

    const user = userEvent.setup();
    renderApp(<PacketCapture />, { authenticated: true });

    await user.click(await screen.findByRole('button', { name: /resume/i }, { timeout: 10_000 }));

    await waitFor(() => expect(started).toHaveLength(1));
    // The RECORDED settings, not whatever the form happened to hold. The form is
    // filled too, but React state is not updated synchronously, so a resume that
    // read the fields would send the previous values.
    expect(started[0]).toMatchObject({ interfaceName: 'eth0', snaplength: '65535', timeout: '1000' });
  });

  it('says nothing when nothing was left running', async () => {
    // The ordinary case, and the one that must not grow a banner: `IDLE_STATUS`
    // carries `interrupted: null`.
    renderApp(<PacketCapture />, { authenticated: true });

    await screen.findByRole('combobox', { name: /network interface/i }, { timeout: 10_000 });
    expect(screen.queryByText(/stopped unexpectedly/i)).not.toBeInTheDocument();
  });
});
