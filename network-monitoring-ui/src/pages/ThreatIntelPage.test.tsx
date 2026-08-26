import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { INTEL_STATUS } from '../test/fixtures';
import { renderApp } from '../test/render';
import { server } from '../test/server';
import ThreatIntelPage from './ThreatIntelPage';

/**
 * The threat-intelligence page.
 *
 * What this page is for is making a *degraded* feed visible. "1,204 indicators
 * loaded" is the least useful thing the feature can report: a feed silently
 * serving an empty file, or falling back to a months-old cache, looks identical
 * to a healthy one from a total. So most of what is asserted here is that the
 * unhealthy states are surfaced, not that the numbers render.
 */

const row = (name: string) => {
  const cell = screen.getByText(name);
  const tableRow = cell.closest('tr');
  if (!tableRow) throw new Error(`no row for feed "${name}"`);
  return within(tableRow);
};

describe('ThreatIntelPage', () => {
  it('lists every feed with where its contents came from', async () => {
    renderApp(<ThreatIntelPage />, { authenticated: true });

    expect(await screen.findByText('feodo')).toBeInTheDocument();
    expect(row('feodo').getByText('Live')).toBeInTheDocument();
    expect(row('drop').getByText('Cached')).toBeInTheDocument();
    expect(row('internal').getByText('Local file')).toBeInTheDocument();
    expect(row('urlhaus').getByText('Failed')).toBeInTheDocument();
  });

  it('puts the degraded feeds at the top, not in alphabetical order', async () => {
    // The default sort is by origin, worst first. Alphabetically "file" sits
    // between "cache" and "failed", which buries the row worth acting on in the
    // middle of the table.
    renderApp(<ThreatIntelPage />, { authenticated: true });
    await screen.findByText('feodo');
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((tableRow) => tableRow.querySelector('td')?.textContent ?? '');

    expect(names[0]).toMatch(/urlhaus/);
    expect(names[1]).toMatch(/drop/);
  });

  it('shows the error a failed feed reported', async () => {
    renderApp(<ThreatIntelPage />, { authenticated: true });
    expect(await screen.findByText('HTTP 503')).toBeInTheDocument();
  });

  it('warns prominently that a feed failed, above the table', async () => {
    // Buried in a row of otherwise healthy numbers this is easy to miss, and a
    // detector that stopped matching looks like coverage.
    renderApp(<ThreatIntelPage />, { authenticated: true });

    // Scoped to the banner: the feed name also appears in the table below, and
    // the point of this test is that it is called out *above* it.
    const banner = (await screen.findByText(/could not be loaded at all/i)).closest('.MuiAlert-root');
    expect(banner).not.toBeNull();
    expect(within(banner as HTMLElement).getByText(/urlhaus/)).toBeInTheDocument();
  });

  it('warns about a cached fallback when nothing has outright failed', async () => {
    server.use(
      http.get('/api/intel/status', () =>
        HttpResponse.json({
          ...INTEL_STATUS,
          sources: INTEL_STATUS.sources.filter((feed) => feed.from !== 'failed'),
        }),
      ),
    );

    renderApp(<ThreatIntelPage />, { authenticated: true });
    expect(await screen.findByText(/fell back to a cached copy/i)).toBeInTheDocument();
  });

  it('explains how to switch the feature on when it is off', async () => {
    // A blank page reading "0 indicators" would be indistinguishable from a
    // broken one, and off-by-default is deliberate here.
    server.use(
      http.get('/api/intel/status', () =>
        HttpResponse.json({
          enabled: false,
          loadedAt: null,
          refreshSeconds: 21600,
          stats: { total: 0, ipv4: 0, ipv6: 0, cidr: 0, domain: 0, rejected: 0, bySource: {} },
          sources: [],
        }),
      ),
    );

    renderApp(<ThreatIntelPage />, { authenticated: true });
    expect(await screen.findByText(/threat intelligence is off/i)).toBeInTheDocument();
    expect(screen.getByText(/INTEL_ENABLED=true/)).toBeInTheDocument();
  });

  it('says so when enabled with no feeds configured', async () => {
    server.use(
      http.get('/api/intel/status', () =>
        HttpResponse.json({
          enabled: true,
          loadedAt: null,
          refreshSeconds: 21600,
          stats: { total: 0, ipv4: 0, ipv6: 0, cidr: 0, domain: 0, rejected: 0, bySource: {} },
          sources: [],
        }),
      ),
    );

    renderApp(<ThreatIntelPage />, { authenticated: true });
    expect(await screen.findByText(/no feeds are configured/i)).toBeInTheDocument();
  });

  it('reloads on demand and reports what came back', async () => {
    const user = userEvent.setup();
    renderApp(<ThreatIntelPage />, { authenticated: true });

    const button = await screen.findByRole('button', { name: /reload feeds/i });
    await user.click(button);

    expect(await screen.findByText(/Reloaded 1,204 indicators/i)).toBeInTheDocument();
  });

  it('surfaces a refused reload rather than looking like it worked', async () => {
    // The server answers 409 while a reload is already running and 503 when every
    // source failed. Both leave the previous indicators in place, and both used
    // to be indistinguishable from success.
    server.use(
      http.post('/api/intel/reload', () =>
        HttpResponse.json(
          { status: 'kept-previous', message: 'Reload did not produce a usable set.' },
          { status: 503 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderApp(<ThreatIntelPage />, { authenticated: true });
    await user.click(await screen.findByRole('button', { name: /reload feeds/i }));

    expect(await screen.findByText(/did not produce a usable set/i)).toBeInTheDocument();
  });

  it('reports a status failure instead of rendering an empty page', async () => {
    server.use(http.get('/api/intel/status', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderApp(<ThreatIntelPage />, { authenticated: true });
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });
});
