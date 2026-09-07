import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  ACCOUNTS,
  ADHOC_OFF,
  ADHOC_SETTINGS,
  ADMIN_USER,
  ALERTS,
  AUDIT_ACTIONS,
  AUDIT_EVENTS,
  DASHBOARD,
  DELIVERY_SETTINGS,
  IDLE_STATUS,
  INTEL_STATUS,
  INTERFACES,
  NOTIFY_STATUS,
  PACKET,
  SUPPRESSION_PREVIEW,
  SUPPRESSION_RULES,
} from './fixtures';

/**
 * Default handlers: the happy path. Individual tests override with
 * `server.use(...)` to inject a failure or a different state.
 */
export const handlers = [
  http.post('/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password !== 'correct-password') {
      return HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 });
    }
    return HttpResponse.json({
      id: 1,
      email: body.email,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      token: 'test-token',
    });
  }),

  http.get('/auth/me', ({ request }) => {
    // Mirrors the real guard: no bearer token means 401.
    if (!request.headers.get('authorization')) {
      return HttpResponse.json({ message: 'Missing Authorization header' }, { status: 401 });
    }
    return HttpResponse.json(ADMIN_USER);
  }),

  http.post('/auth/signup', () => HttpResponse.json(ADMIN_USER, { status: 201 })),

  /**
   * Defaults to the secure state, matching a real installation that already has
   * users. Tests that need first-time setup or open registration override it.
   */
  http.get('/auth/signup-allowed', () => HttpResponse.json({ allowed: false, mode: 'admin-only' })),

  http.get('/api/notify/status', () => HttpResponse.json(NOTIFY_STATUS)),

  http.get('/api/notify/settings', () => HttpResponse.json(DELIVERY_SETTINGS)),

  http.put('/api/notify/settings', async ({ request }) => {
    const patch = (await request.json()) as Record<string, unknown>;
    const settings = { ...DELIVERY_SETTINGS.settings };
    for (const [key, value] of Object.entries(patch)) {
      settings[key] = value === null ? { source: 'default' } : { source: 'database', value };
    }
    return HttpResponse.json({ ...DELIVERY_SETTINGS, settings });
  }),

  http.post('/api/notify/test', () =>
    HttpResponse.json({
      delivered: 2,
      results: [
        { channel: 'webhook', ok: true, detail: 'delivered' },
        { channel: 'syslog', ok: true, detail: 'sent 1 event(s) to siem.internal:514 over udp' },
      ],
    }),
  ),

  http.get('/api/suppressions', () => HttpResponse.json(SUPPRESSION_RULES)),

  http.post('/api/suppressions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        ...SUPPRESSION_RULES.rules[0],
        ...body,
        id: 99,
        matchCount: 0,
        lastMatchAt: null,
      },
      { status: 201 },
    );
  }),

  http.patch('/api/suppressions/:id', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const existing = SUPPRESSION_RULES.rules.find((rule) => String(rule.id) === params.id);
    return HttpResponse.json({ ...existing, ...body });
  }),

  http.delete('/api/suppressions/:id', () => new HttpResponse(null, { status: 204 })),

  http.post('/api/suppressions/preview', () => HttpResponse.json(SUPPRESSION_PREVIEW)),

  http.get('/api/intel/status', () => HttpResponse.json(INTEL_STATUS)),

  http.post('/api/intel/reload', () =>
    HttpResponse.json({
      status: 'loaded',
      loadedAt: '2026-08-26T12:00:00.000Z',
      indicators: 1204,
      sources: INTEL_STATUS.sources,
    }),
  ),

  http.get('/api/alerts', ({ request }) => {
    const url = new URL(request.url);
    let rows = [...ALERTS];

    const severity = url.searchParams.get('severity');
    if (severity) rows = rows.filter((row) => row.severity === severity);

    const kind = url.searchParams.get('kind');
    if (kind) rows = rows.filter((row) => row.kind === kind);

    const acknowledged = url.searchParams.get('acknowledged');
    if (acknowledged === 'false') rows = rows.filter((row) => row.acknowledgedAt === null);

    const sensor = url.searchParams.get('sensor');
    if (sensor) rows = rows.filter((row) => row.sensorId === sensor);

    return HttpResponse.json(rows);
  }),

  http.get('/api/alerts/summary', () =>
    HttpResponse.json({
      total: DASHBOARD.total,
      unacknowledged: DASHBOARD.unacknowledged,
      bySeverity: DASHBOARD.bySeverity,
      byKind: DASHBOARD.byKind,
      latestAt: DASHBOARD.latestAt,
    }),
  ),

  http.get('/api/alerts/dashboard', () => HttpResponse.json(DASHBOARD)),
  http.get('/api/alerts/devices', () => HttpResponse.json([])),

  // One sensor by default, which is what every installation has until somebody
  // deploys a second: the sensor column and filter are hidden in that case, so
  // this default keeps every other test on this page describing the single-sensor
  // interface. A test about two sensors overrides it.
  http.get('/api/alerts/sensors', () =>
    HttpResponse.json([{ sensorId: 'default', self: true, alerts: 2, latestAt: null }]),
  ),

  http.post('/api/alerts/:id/acknowledge', ({ params }) =>
    HttpResponse.json({
      ...ALERTS.find((a) => String(a.id) === params.id),
      acknowledgedAt: '2026-07-26T10:00:00.000Z',
      acknowledgedBy: 'admin@example.com',
    }),
  ),
  http.post('/api/alerts/:id/unacknowledge', ({ params }) =>
    HttpResponse.json({ ...ALERTS.find((a) => String(a.id) === params.id), acknowledgedAt: null }),
  ),
  http.delete('/api/alerts/:id', () => new HttpResponse(null, { status: 204 })),

  // Both capture scopes share these shapes.
  http.get('*/packets/nif', () => HttpResponse.json(INTERFACES)),
  http.get('*/packets/status', () => HttpResponse.json(IDLE_STATUS)),
  http.get('/api/packets', () => HttpResponse.json([PACKET])),
  http.get('/api/ip/packets', () => HttpResponse.json([PACKET])),
  http.post('*/packets/start', () => HttpResponse.json(IDLE_STATUS)),
  http.post('*/packets/stop', () => HttpResponse.json(IDLE_STATUS)),
  http.post('*/packets/clear', () => new HttpResponse(null, { status: 204 })),
  /*
   * The query console, off by default — which is what a real installation looks
   * like until somebody decides otherwise, and the state the diagnostics exist
   * to explain.
   */
  http.get('/auth/users', () => HttpResponse.json(ACCOUNTS)),
  // Echoes the requested role back on the account that was asked for, which is
  // what the real endpoint returns (`toPublicUser` of the updated row). A test
  // that needs a refusal overrides this with the status it wants.
  http.patch('/auth/users/:id/role', async ({ params, request }) => {
    const { role } = (await request.json()) as { role: string };
    const account = ACCOUNTS.find((candidate) => String(candidate.id) === String(params.id));
    if (!account) return HttpResponse.json({ message: 'No such account.' }, { status: 404 });
    return HttpResponse.json({ ...account, role });
  }),
  http.get('/api/adhoc', () => HttpResponse.json(ADHOC_OFF)),
  http.get('/api/adhoc/settings', () => HttpResponse.json(ADHOC_SETTINGS)),
  http.put('/api/adhoc/settings', () => HttpResponse.json({ effective: ADHOC_SETTINGS.effective })),
  http.post('/api/adhoc/recheck', () => HttpResponse.json(ADHOC_OFF)),
  http.get('/api/audit/actions', () => HttpResponse.json(AUDIT_ACTIONS)),
  // Filtering and paging are the server's job; the handler honours the filter so a
  // test can assert the page asked for it, and returns no cursor so "load older"
  // stays hidden unless a test overrides this.
  http.get('/api/audit', ({ request }) => {
    const action = new URL(request.url).searchParams.get('action');
    const events = action ? AUDIT_EVENTS.filter((event) => event.action === action) : AUDIT_EVENTS;
    return HttpResponse.json({ events });
  }),
  http.get('*/packets/ip-info', ({ request }) => {
    const ipAddress = new URL(request.url).searchParams.get('ipAddress') ?? '';
    return HttpResponse.json({
      ipAddress,
      domainName: 'example.invalid',
      whoisData: 'whois output for testing',
      geoData: { status: 'success', country: 'Testland', city: 'Testville', isp: 'Test ISP' },
    });
  }),
];

export const server = setupServer(...handlers);
