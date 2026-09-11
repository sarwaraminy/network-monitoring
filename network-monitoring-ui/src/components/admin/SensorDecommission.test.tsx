import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { RETIRABLE_SENSORS } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import SensorDecommission from './SensorDecommission';

/**
 * Retiring a sensor, from the administrator's side.
 *
 * The most destructive control in the interface, and the only one with nothing to
 * undo it: the findings, devices and rollup buckets are gone and the audit entry
 * is what is left. So what these cases are about is not the happy path — that is
 * one `DELETE` — but the two things the panel has to get right before it sends it.
 *
 *  - **The confirmation says what is lost.** "Decommission branch-2" is not
 *    enough information to decide with. The counts come from the server, so a
 *    panel that recomputed or omitted them would be asking somebody to confirm a
 *    number nobody has seen.
 *  - **It never offers this installation.** The server excludes the live sensor
 *    from the list and refuses the request anyway, but a panel that added it back
 *    — from the sensor filter's list, which *does* include it — would be offering
 *    an action guaranteed to fail.
 */

const empty = () => server.use(http.get('/api/alerts/sensors/retirable', () => HttpResponse.json([])));

describe('decommissioning a sensor', () => {
  it('lists each retirable sensor with what is recorded under it', async () => {
    renderApp(<SensorDecommission />);

    expect(await screen.findByText('branch-2')).toBeInTheDocument();
    // The fixture's counts, formatted through the application locale.
    expect(screen.getByText('4,812')).toBeInTheDocument();
    expect(screen.getByText('260')).toBeInTheDocument();
    expect(screen.getByText('190')).toBeInTheDocument();
  });

  it('never offers the sensor serving the page', async () => {
    /*
     * `default` is what the sensor-filter fixture reports as `self`. It is
     * deliberately absent from the retirable list, and this asserts the panel
     * reads that list rather than reaching for the filter's — which includes the
     * live sensor by design, so that a correctly configured new install does not
     * render as an installation that does not exist.
     */
    renderApp(<SensorDecommission />);

    await screen.findByText('branch-2');
    expect(screen.queryByText('default')).not.toBeInTheDocument();
  });

  it('says a sensor with only aggregated history has never been seen', async () => {
    // Retention's end state: the detail expired and was rolled up. A date here
    // would be one the panel invented.
    renderApp(<SensorDecommission />);

    expect(await screen.findByText('old-laptop')).toBeInTheDocument();
    expect(screen.getByText('never')).toBeInTheDocument();
  });

  it('will not offer to retire a sensor that is still writing', async () => {
    /*
     * The server refuses these, so offering the button would be offering a
     * guaranteed 409. Disabled with the reason on the tooltip, following what
     * `UserRoles` does for the two role changes it knows are impossible.
     *
     * The server is still what enforces it: this list can be minutes stale by
     * the time somebody presses a button, which is why the decommission
     * re-checks inside its own transaction.
     */
    server.use(
      http.get('/api/alerts/sensors/retirable', () =>
        HttpResponse.json([{ ...RETIRABLE_SENSORS[0], active: true }]),
      ),
    );
    renderApp(<SensorDecommission />);

    const button = await screen.findByRole('button', { name: /decommission sensor branch-2/i });
    expect(button).toBeDisabled();
    // And says why, rather than being a dead control somebody files a bug about.
    expect(screen.getByText('still writing')).toBeInTheDocument();
  });

  it('asks before deleting, and names what would go', async () => {
    renderApp(<SensorDecommission />);
    await userEvent.click(await screen.findByLabelText('Decommission sensor branch-2'));

    const warning = await screen.findByText(/permanently deletes/);
    expect(warning).toHaveTextContent('4,812 findings');
    expect(warning).toHaveTextContent('260 devices');
    expect(warning).toHaveTextContent('190 aggregated days');
    expect(warning).toHaveTextContent('branch-2');
  });

  it('sends nothing until the confirmation is pressed', async () => {
    let sent = 0;
    server.use(
      http.delete('/api/alerts/sensors/:sensorId', () => {
        sent += 1;
        return HttpResponse.json({
          sensorId: 'branch-2',
          removed: { alerts: 1, devices: 1, rollupBuckets: 1, captureSessions: 1 },
        });
      }),
    );

    renderApp(<SensorDecommission />);
    await userEvent.click(await screen.findByLabelText('Decommission sensor branch-2'));
    await screen.findByText(/permanently deletes/);

    expect(sent).toBe(0);
  });

  it('abandons the confirmation on cancel', async () => {
    renderApp(<SensorDecommission />);
    await userEvent.click(await screen.findByLabelText('Decommission sensor branch-2'));
    await screen.findByText(/permanently deletes/);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText(/permanently deletes/)).not.toBeInTheDocument());
  });

  it('reports what the server actually removed', async () => {
    /*
     * The server's counts, not the ones the list was showing. They can differ: a
     * sensor sharing this database may have written another row between the panel
     * loading and the button being pressed, and the honest number is the one the
     * transaction deleted.
     */
    server.use(
      http.delete('/api/alerts/sensors/:sensorId', () =>
        HttpResponse.json({
          sensorId: 'branch-2',
          removed: { alerts: 5000, devices: 261, rollupBuckets: 190, captureSessions: 1 },
        }),
      ),
    );

    renderApp(<SensorDecommission />);
    await userEvent.click(await screen.findByLabelText('Decommission sensor branch-2'));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it all' }));

    const toast = await screen.findByText(/is decommissioned/);
    expect(toast).toHaveTextContent('5,000 findings');
    expect(toast).toHaveTextContent('261 devices');
  });

  it("shows the server's own refusal, which says which mistake this was", async () => {
    // The two refusals have different remedies — "nothing under that name" means
    // the wrong row, "that is this installation" means the wrong idea — so the
    // message is shown verbatim rather than replaced with a generic failure.
    server.use(
      http.delete('/api/alerts/sensors/:sensorId', () =>
        HttpResponse.json(
          { message: 'branch-2 is this installation, which is still writing findings and devices' },
          { status: 409 },
        ),
      ),
    );

    renderApp(<SensorDecommission />);
    await userEvent.click(await screen.findByLabelText('Decommission sensor branch-2'));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it all' }));

    expect(await screen.findByText(/is this installation/)).toBeInTheDocument();
  });

  it('explains an empty list rather than showing nothing', async () => {
    // "No sensors" on a working installation reads as a bug. The empty state has
    // to say that this installation is excluded on purpose.
    empty();
    renderApp(<SensorDecommission />);

    expect(await screen.findByText(/No other sensor has written anything/)).toBeInTheDocument();
  });

  it('reports a failure to read the list', async () => {
    server.use(
      http.get('/api/alerts/sensors/retirable', () =>
        HttpResponse.json({ message: 'nope' }, { status: 500 }),
      ),
    );
    renderApp(<SensorDecommission />);

    expect(await screen.findByText(/Could not read the sensors|nope/)).toBeInTheDocument();
  });
});
