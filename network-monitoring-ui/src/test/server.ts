import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { ADMIN_USER, ALERTS, DASHBOARD, IDLE_STATUS, INTERFACES, PACKET } from './fixtures';

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

  http.get('/api/alerts', ({ request }) => {
    const url = new URL(request.url);
    let rows = [...ALERTS];

    const severity = url.searchParams.get('severity');
    if (severity) rows = rows.filter((row) => row.severity === severity);

    const kind = url.searchParams.get('kind');
    if (kind) rows = rows.filter((row) => row.kind === kind);

    const acknowledged = url.searchParams.get('acknowledged');
    if (acknowledged === 'false') rows = rows.filter((row) => row.acknowledgedAt === null);

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
