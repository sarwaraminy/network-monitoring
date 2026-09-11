import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { decommissionSensor, fetchRetirableSensors } from '../../api/alerts.api';
import { describeError } from '../../api/client';
import { ALERTS_ROOT_KEY, queryKeys } from '../../api/queryClient';
import { useFormatters } from '../../i18n/format';
import { type Message, useMessageText } from '../../i18n/message-state';
import { useT } from '../../i18n/ui';
import Identifier from '../Identifier';

/**
 * Retiring a sensor that will not report again.
 *
 * Every finding, device and rollup bucket carries the `sensor_id` of the
 * installation that wrote it, and nothing could ever remove a set of them. So a
 * sensor retired after a hardware swap, or one whose host came back with a
 * different `SENSOR_ID`, stayed in the sensor filter and the device inventory for
 * ever — and retention could not reclaim the rows, because each sensor's
 * staleness cutoff is derived from its own last sighting and that stops advancing
 * with it.
 *
 * **The list here is not the sensor filter's list.** `GET /sensors` includes the
 * installation serving the page even before it has written anything, which is
 * right for a filter and wrong for this: the server excludes the live sensor from
 * `/sensors/retirable` so that it is never offered, and refuses the request
 * outright if one is constructed anyway. Emptying `known_devices` for a running
 * sensor would re-arm new-device detection across the whole segment.
 *
 * **The counts are the point of the confirmation.** "Decommission sensor
 * branch-2" tells an administrator nothing about what they are about to lose;
 * "4,812 findings, 260 devices and 190 aggregated days" does. They are read from
 * the server rather than recounted here, and the toast afterwards reports what
 * was actually removed, which can differ — a sensor sharing this database may
 * have written another row between the page loading and the button being pressed.
 */
export default function SensorDecommission() {
  const t = useT();
  const fmt = useFormatters();
  const queryClient = useQueryClient();
  const sensors = useQuery({ queryKey: queryKeys.retirableSensors, queryFn: fetchRetirableSensors });
  // The message, not its words — see i18n/message-state.ts. A rendered sentence
  // would stay in whatever language raised it.
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; body: Message } | null>(null);
  const messageText = useMessageText();
  /**
   * Which row is asking to be confirmed.
   *
   * A second step rather than a plain button, because this is the most
   * destructive action in the interface and the only one with nothing to undo it:
   * the rows are gone and the audit entry is all that is left. Inline rather than
   * a nested dialog — this panel already renders inside one — and it names the
   * counts, so the confirmation says what is being lost instead of asking whether
   * you are sure.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  const retire = useMutation({
    mutationFn: (sensorId: string) => decommissionSensor(sensorId),
    onSuccess: (result) => {
      setConfirming(null);
      setMessage({
        severity: 'success',
        body: {
          key: 'sensors.retired_toast',
          params: {
            sensor: result.sensorId,
            alerts: result.removed.alerts,
            devices: result.removed.devices,
            buckets: result.removed.rollupBuckets,
          },
        },
      });
      /*
       * The whole `alerts` root, not just this list.
       *
       * Everything downstream of a sensor's rows is now wrong at once: the alert
       * table, the summary tiles, the dashboard trend and the device inventory
       * were all reading rows that no longer exist, and the sensor filter on two
       * pages is offering a name that is gone. `AlertsPage` derives
       * `appliedSensor` so that a vanished sensor does not silently filter the
       * table to nothing — but it can only do that once it has been told the list
       * changed, which is this line.
       */
      void queryClient.invalidateQueries({ queryKey: ALERTS_ROOT_KEY });
    },
    // The server's own message, verbatim: it distinguishes "nothing under that
    // name" from "that is this installation", and only one of them means the
    // operator picked the wrong row.
    onError: (error) =>
      setMessage({ severity: 'error', body: { error, fallbackKey: 'sensors.retire_failed' } }),
  });

  if (sensors.isPending) return <Typography variant="body2">{t('sensors.loading')}</Typography>;
  if (sensors.isError) {
    return <Alert severity="error">{describeError(sensors.error, t('sensors.load_failed'))}</Alert>;
  }

  const rows = sensors.data;

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.severity}>{messageText(message.body)}</Alert>}

      {rows.length === 0 ? (
        // Both halves matter: there is nothing to do, and the reason this
        // installation is not on the list is that it is still writing.
        <Alert severity="info">{t('sensors.none')}</Alert>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('sensors.col_sensor')}</TableCell>
                <TableCell align="right">{t('sensors.col_findings')}</TableCell>
                <TableCell align="right">{t('sensors.col_devices')}</TableCell>
                <TableCell align="right">{t('sensors.col_history')}</TableCell>
                <TableCell>{t('sensors.col_last_seen')}</TableCell>
                <TableCell sx={{ width: 220 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((sensor) => (
                <TableRow key={sensor.sensorId}>
                  <TableCell>
                    {/* A sensor id is matched against configuration outside this
                        application, so it is isolated rather than laid out with
                        the sentence around it. */}
                    <Identifier>{sensor.sensorId}</Identifier>
                  </TableCell>
                  <TableCell align="right">{fmt.number(sensor.alerts)}</TableCell>
                  <TableCell align="right">{fmt.number(sensor.devices)}</TableCell>
                  <TableCell align="right">{fmt.number(sensor.rollupBuckets)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <span>
                        {sensor.lastSeen ? fmt.dateTime(sensor.lastSeen) : t('sensors.last_seen_never')}
                      </span>
                      {/* The reason the control beside it is disabled, next to the
                          date it is derived from. */}
                      {sensor.active && (
                        <Chip size="small" color="warning" variant="outlined" label={t('sensors.active')} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {confirming === sensor.sensorId ? (
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          color="error"
                          variant="contained"
                          disabled={retire.isPending}
                          onClick={() => {
                            setMessage(null);
                            retire.mutate(sensor.sensorId);
                          }}
                        >
                          {t('sensors.confirm_retire')}
                        </Button>
                        <Button size="small" disabled={retire.isPending} onClick={() => setConfirming(null)}>
                          {t('common.cancel')}
                        </Button>
                      </Stack>
                    ) : (
                      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                        {/*
                          Disabled for a sensor that is evidently still writing,
                          with the reason on the tooltip — the convention
                          `UserRoles` follows for the two role changes it knows the
                          server will refuse. A disabled control with no
                          explanation is the thing an administrator files a bug
                          about.

                          The server refuses it regardless: this list can be
                          minutes stale by the time the button is pressed, so the
                          decommission re-checks inside its own transaction.
                        */}
                        <Tooltip title={sensor.active ? t('sensors.active_hint') : ''}>
                          <span>
                            <Button
                              size="small"
                              color="error"
                              // Named per row, so each button is addressable — by
                              // a screen reader and by a test alike. Four buttons
                              // all called "Retire" are four buttons nobody can
                              // name.
                              aria-label={t('sensors.retire_sensor', { sensor: sensor.sensorId })}
                              disabled={retire.isPending || sensor.active}
                              onClick={() => {
                                setMessage(null);
                                setConfirming(sensor.sensorId);
                              }}
                            >
                              {t('sensors.retire')}
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {confirming && (
        <Alert severity="warning">
          {t('sensors.confirm_body', {
            sensor: confirming,
            alerts: rows.find((row) => row.sensorId === confirming)?.alerts ?? 0,
            devices: rows.find((row) => row.sensorId === confirming)?.devices ?? 0,
            buckets: rows.find((row) => row.sensorId === confirming)?.rollupBuckets ?? 0,
          })}
        </Alert>
      )}

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('sensors.audit_note')}
      </Typography>
    </Stack>
  );
}
