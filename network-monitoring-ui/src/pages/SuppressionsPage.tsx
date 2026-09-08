import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import RuleFolderOutlinedIcon from '@mui/icons-material/RuleFolderOutlined';
import ToggleOffOutlinedIcon from '@mui/icons-material/ToggleOffOutlined';
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MRT_ColumnDef } from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { describeError } from '../api/client';
import {
  createSuppression,
  deleteSuppression,
  fetchSuppressions,
  previewSuppression,
  updateSuppression,
} from '../api/suppressions.api';
import DataGrid, { numericColumn } from '../components/DataGrid';
import StatTile from '../components/StatTile';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useFormatters } from '../i18n/format';
import { useT } from '../i18n/ui';
import { ALERT_KINDS, type AlertKind, type SuppressionDraft, type SuppressionRule } from '../types';

/**
 * Suppression rules.
 *
 * The page an operator uses to say "yes, I know, that one is expected" — and the
 * reason this tool can survive its second month. An authorised scanner sweeping
 * the estate nightly raises a correct `high` finding nightly, forever, and with no
 * way to record that, the real findings end up underneath a pile of known-good
 * noise.
 *
 * Everything in the layout below follows from one fact: a suppressed finding is
 * DROPPED, not hidden. There is no "show suppressed" toggle to fall back on, so
 * the page has to make the cost of each rule legible on its own:
 *
 *  - "Findings hidden" is a headline tile rather than a detail column, because a
 *    rule quietly eating thousands of findings a day should not need looking for.
 *  - A rule that has never matched is called out. It is either wrong — a typo in
 *    the range — or no longer needed, and both are worth knowing.
 *  - Expired and invalid rules are shown in place rather than filtered out. A rule
 *    whose range will not parse matches nothing at all while its author believes
 *    otherwise, which is the worst state available here.
 */

type RuleState = 'active' | 'disabled' | 'expired' | 'invalid';

const STATE: Record<
  RuleState,
  { label: string; color: 'success' | 'default' | 'warning' | 'error'; hint: string }
> = {
  active: {
    label: 'Active',
    color: 'success',
    hint: 'Findings matching this rule are being dropped before they are stored.',
  },
  disabled: {
    label: 'Off',
    color: 'default',
    hint: 'Switched off. Findings that match are stored and delivered as normal.',
  },
  expired: {
    label: 'Expired',
    color: 'warning',
    hint: 'The expiry has passed, so this rule no longer suppresses anything. Extend it or delete it.',
  },
  invalid: {
    label: 'Invalid',
    color: 'error',
    hint:
      'The server could not parse this rule’s address range, so it matches nothing at all. ' +
      'Edit the range — findings you believe are suppressed are not.',
  },
};

/** `invalid` maps a rule id to why the server cannot use it. */
function ruleState(rule: SuppressionRule, invalid: Map<number, string>, now: number): RuleState {
  if (invalid.has(rule.id)) return 'invalid';
  if (!rule.enabled) return 'disabled';
  if (rule.expiresAt !== null && new Date(rule.expiresAt).getTime() <= now) return 'expired';
  return 'active';
}

/** Only an active rule is actually suppressing anything. */
function isInForce(state: RuleState): boolean {
  return state === 'active';
}

const ROW_EDGE: Record<RuleState, string> = {
  active: 'transparent',
  disabled: 'action.disabled',
  expired: 'warning.main',
  invalid: 'error.main',
};

/** `port_scan` reads as "Port scan" in a table; the wire value stays in the filter. */
function kindLabel(kind: string): string {
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** One line describing what a rule covers, in the order an operator reads it. */
function describeRule(rule: SuppressionRule): string {
  const parts: string[] = [];
  parts.push(rule.kind ? kindLabel(rule.kind) : 'Any finding');
  if (rule.sourceCidr) parts.push(`from ${rule.sourceCidr}`);
  if (rule.targetCidr) parts.push(`to ${rule.targetCidr}`);
  if (rule.port !== null) parts.push(`on port ${rule.port}`);
  return parts.join(' ');
}

const EMPTY_DRAFT: SuppressionDraft = {
  kind: null,
  sourceCidr: null,
  targetCidr: null,
  port: null,
  reason: '',
  enabled: true,
  expiresAt: null,
};

export default function SuppressionsPage() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<{ rule: SuppressionRule | null } | null>(null);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const listing = useQuery({ queryKey: ['suppressions'], queryFn: fetchSuppressions });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['suppressions'] });
    // The alert list is downstream of these rules: a rule that starts suppressing
    // changes what arrives next, and one switched off changes it back.
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  }, [queryClient]);

  const toggle = useMutation({
    mutationFn: ({ rule }: { rule: SuppressionRule }) =>
      // Only `enabled` is sent. Resending the criteria would clobber a change
      // somebody else made between this page loading and the switch being flipped.
      updateSuppression(rule.id, { enabled: !rule.enabled }),
    onSuccess: (updated) => {
      setMessage({
        severity: 'success',
        text: updated.enabled
          ? `Rule #${updated.id} is on. Matching findings are being dropped.`
          : `Rule #${updated.id} is off. Matching findings will be stored again.`,
      });
      refresh();
    },
    onError: (error) =>
      setMessage({ severity: 'error', text: describeError(error, 'Could not update the rule') }),
  });

  const remove = useMutation({
    mutationFn: (rule: SuppressionRule) => deleteSuppression(rule.id),
    onSuccess: () => {
      setMessage({ severity: 'success', text: 'Rule deleted.' });
      refresh();
    },
    onError: (error) =>
      setMessage({ severity: 'error', text: describeError(error, 'Could not delete the rule') }),
  });

  const handleEdit = useCallback((rule: SuppressionRule) => setEditing({ rule }), []);
  const handleToggle = useCallback((rule: SuppressionRule) => toggle.mutate({ rule }), [toggle]);
  const handleDelete = useCallback(
    (rule: SuppressionRule) => {
      // Deliberately a confirm rather than an undo: deleting discards the match
      // count, which is the only record of what the rule hid.
      if (
        window.confirm(
          `Delete rule #${rule.id}? Its record of ${rule.matchCount.toLocaleString()} hidden findings goes with it. Switching it off keeps both.`,
        )
      ) {
        remove.mutate(rule);
      }
    },
    [remove],
  );

  const rules = listing.data?.rules ?? [];
  const invalid = useMemo(
    () => new Map((listing.data?.invalid ?? []).map((problem) => [problem.id, problem.reason])),
    [listing.data],
  );
  const now = Date.now();

  const states = rules.map((rule) => ruleState(rule, invalid, now));
  const inForce = states.filter(isInForce).length;
  const expired = states.filter((state) => state === 'expired').length;
  const hidden = rules.reduce((total, rule) => total + rule.matchCount, 0);
  const neverMatched = rules.filter(
    (rule, index) => rule.matchCount === 0 && isInForce(states[index]!),
  ).length;

  return (
    <>
      <SurfaceCard
        title={t('suppressions.title')}
        titleComponent="h1"
        titleVariant="h5"
        subtitle={t('suppressions.subtitle')}
        headerActions={
          isAdmin ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setEditing({ rule: null })}
            >
              {t('suppressions.new_rule')}
            </Button>
          ) : null
        }
      />

      {listing.error && (
        <Alert severity="error">{describeError(listing.error, 'Could not read the suppression rules')}</Alert>
      )}

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/*
        Surfaced above the table, because a rule the server cannot use is doing
        nothing while its author believes it is — the one failure here that is
        invisible from the outside. Each reason is named rather than counted: "1
        rule is invalid" sends an operator hunting through the table for it.
      */}
      {invalid.size > 0 && (
        <Alert severity="error">
          {invalid.size} rule{invalid.size === 1 ? '' : 's'} cannot match anything, so findings you believe
          are suppressed are not being suppressed:
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {[...invalid].map(([id, reason]) => (
              <li key={id}>
                <strong>#{id}</strong> — {reason}
              </li>
            ))}
          </Box>
        </Alert>
      )}

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('suppressions.rules')}
            value={rules.length}
            caption={`${inForce} in force`}
            icon={<RuleFolderOutlinedIcon />}
            loading={listing.isPending}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('suppressions.findings_hidden')}
            value={hidden}
            caption={t('suppressions.hidden_caption')}
            icon={<VisibilityOffOutlinedIcon />}
            loading={listing.isPending}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('suppressions.never_matched')}
            value={neverMatched}
            caption={t('suppressions.never_caption')}
            icon={<NotificationsOffOutlinedIcon />}
            loading={listing.isPending}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile
            label={t('suppressions.expired')}
            value={expired}
            caption={t('suppressions.expired_caption')}
            icon={<EventBusyOutlinedIcon />}
            loading={listing.isPending}
          />
        </Grid>
      </Grid>

      <RuleTable
        rules={rules}
        invalid={invalid}
        now={now}
        loading={listing.isPending}
        isAdmin={isAdmin}
        onEdit={handleEdit}
        onToggle={handleToggle}
        onDelete={handleDelete}
      />

      {editing && (
        <RuleDialog
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            setMessage({
              severity: 'success',
              text: created ? `Rule #${saved.id} created and in force.` : `Rule #${saved.id} updated.`,
            });
            refresh();
          }}
        />
      )}
    </>
  );
}

interface RuleTableProps {
  rules: SuppressionRule[];
  invalid: Map<number, string>;
  now: number;
  loading: boolean;
  isAdmin: boolean;
  onEdit: (rule: SuppressionRule) => void;
  onToggle: (rule: SuppressionRule) => void;
  onDelete: (rule: SuppressionRule) => void;
}

function RuleTable({
  rules,
  invalid,
  now,
  loading,
  isAdmin,
  onEdit,
  onToggle,
  onDelete,
}: Readonly<RuleTableProps>) {
  const t = useT();
  const fmt = useFormatters();
  const columns = useMemo<MRT_ColumnDef<SuppressionRule>[]>(() => {
    const base: MRT_ColumnDef<SuppressionRule>[] = [
      {
        id: 'covers',
        header: t('suppressions.covers'),
        size: 300,
        accessorFn: describeRule,
        Cell: ({ row }) => (
          <>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {describeRule(row.original)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              #{row.original.id} · added by {row.original.createdBy}
            </Typography>
          </>
        ),
      },
      {
        accessorKey: 'reason',
        header: t('suppressions.why'),
        size: 280,
        Cell: ({ cell }) => (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {cell.getValue<string>()}
          </Typography>
        ),
      },
      {
        id: 'state',
        header: t('suppressions.state'),
        size: 130,
        accessorFn: (rule) => STATE[ruleState(rule, invalid, now)].label,
        filterVariant: 'select',
        // Built explicitly, or MRT faces the raw accessor values and the dropdown
        // drifts from what the chips say.
        filterSelectOptions: Object.values(STATE).map((state) => state.label),
        Cell: ({ row }) => {
          const state = STATE[ruleState(row.original, invalid, now)];
          // The server's own reason beats the generic hint when there is one.
          const reason = invalid.get(row.original.id);
          return (
            <Tooltip title={reason ? `${reason}. ${state.hint}` : state.hint}>
              <Chip size="small" variant="outlined" color={state.color} label={state.label} />
            </Tooltip>
          );
        },
      },
      numericColumn({
        accessorKey: 'matchCount',
        header: t('suppressions.hidden'),
        size: 130,
        Cell: ({ row, cell }) => {
          const count = cell.getValue<number>();
          const state = ruleState(row.original, invalid, now);
          return (
            <Box>
              <Typography
                variant="body2"
                sx={{
                  // A rule in force that has hidden nothing is either wrong or no
                  // longer needed. Neither is visible from the count alone.
                  color: count === 0 && isInForce(state) ? 'warning.main' : 'text.primary',
                  fontWeight: count > 0 ? 600 : 400,
                }}
              >
                {count.toLocaleString()}
              </Typography>
              {row.original.lastMatchAt && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {fmt.relativeTime(row.original.lastMatchAt)}
                </Typography>
              )}
            </Box>
          );
        },
      }),
      {
        accessorKey: 'expiresAt',
        header: t('suppressions.expires'),
        size: 150,
        Cell: ({ cell }) => {
          const value = cell.getValue<string | null>();
          if (!value) {
            return (
              <Tooltip title={t('suppressions.no_expiry')}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('common.never')}
                </Typography>
              </Tooltip>
            );
          }
          return <Typography variant="body2">{fmt.dateTime(value)}</Typography>;
        },
      },
    ];

    if (!isAdmin) return base;

    return [
      ...base,
      {
        id: 'actions',
        header: '',
        size: 140,
        enableSorting: false,
        enableColumnFilter: false,
        enableColumnActions: false,
        Cell: ({ row }) => {
          const rule = row.original;
          return (
            <Stack direction="row" spacing={0.5}>
              <Tooltip title={t('suppressions.edit')}>
                <IconButton size="small" aria-label={`Edit rule ${rule.id}`} onClick={() => onEdit(rule)}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={rule.enabled ? 'Switch off — matching findings return' : 'Switch on'}>
                <IconButton
                  size="small"
                  aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.id}`}
                  onClick={() => onToggle(rule)}
                >
                  {rule.enabled ? (
                    <ToggleOnOutlinedIcon fontSize="small" color="success" />
                  ) : (
                    <ToggleOffOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
              <Tooltip title={t('suppressions.delete')}>
                <IconButton size="small" aria-label={`Delete rule ${rule.id}`} onClick={() => onDelete(rule)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        },
      },
    ];
  }, [invalid, now, isAdmin, onEdit, onToggle, onDelete, t, fmt]);

  return (
    <SurfaceCard
      title={t('suppressions.rules')}
      subtitle={t('suppressions.rules_subtitle')}
      bodyVariant="grid"
      sx={{ height: '100%' }}
    >
      <DataGrid
        columns={columns}
        data={rules}
        isLoading={loading}
        emptyMessage={t('suppressions.none')}
        tableOptions={{
          enableDensityToggle: false,
          enableFullScreenToggle: false,
          enableHiding: false,
          // Oldest first, matching the order the server evaluates them in. Sorting
          // this table by anything else is fine for reading, but the default has to
          // be the real one or "first match wins" means nothing on screen.
          initialState: { density: 'comfortable', sorting: [{ id: 'covers', desc: false }] },
          muiSearchTextFieldProps: { placeholder: 'Search rules', sx: { minWidth: 180 } },
          muiTableBodyRowProps: ({ row }) => ({
            sx: {
              borderLeft: '4px solid',
              borderLeftColor: ROW_EDGE[ruleState(row.original, invalid, now)],
              opacity: isInForce(ruleState(row.original, invalid, now)) ? 1 : 0.72,
            },
          }),
        }}
      />
    </SurfaceCard>
  );
}

interface RuleDialogProps {
  /** Null creates. */
  rule: SuppressionRule | null;
  onClose: () => void;
  onSaved: (saved: SuppressionRule, created: boolean) => void;
}

/**
 * The create/edit form.
 *
 * The "Check against recent alerts" button is the part that matters. Writing a
 * suppression is a guess about a range, and the cost of guessing wide is silence
 * rather than an error message — so the form offers to measure the guess against
 * alerts already stored before it is saved, using the server's own matching code
 * rather than a second copy of it living here.
 */
function RuleDialog({ rule, onClose, onSaved }: Readonly<RuleDialogProps>) {
  const t = useT();
  const fmt = useFormatters();
  const [draft, setDraft] = useState<SuppressionDraft>(() =>
    rule
      ? {
          kind: rule.kind,
          sourceCidr: rule.sourceCidr,
          targetCidr: rule.targetCidr,
          port: rule.port,
          reason: rule.reason,
          enabled: rule.enabled,
          expiresAt: rule.expiresAt,
        }
      : EMPTY_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SuppressionDraft>(key: K, value: SuppressionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const hasCriterion =
    draft.kind !== null || draft.sourceCidr !== null || draft.targetCidr !== null || draft.port !== null;

  const preview = useMutation({
    mutationFn: () =>
      previewSuppression({
        kind: draft.kind,
        sourceCidr: draft.sourceCidr,
        targetCidr: draft.targetCidr,
        port: draft.port,
      }),
    onError: (mutationError) => setError(describeError(mutationError, 'Could not check the rule')),
  });

  const save = useMutation({
    mutationFn: () => (rule ? updateSuppression(rule.id, draft) : createSuppression(draft)),
    onSuccess: (saved) => onSaved(saved, rule === null),
    // Server-side messages are the useful ones here — they name the field and say
    // how to write a range — so they are shown verbatim rather than replaced.
    onError: (mutationError) => setError(describeError(mutationError, 'Could not save the rule')),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{rule ? `Edit rule #${rule.id}` : 'New suppression rule'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          A finding is suppressed when it matches <strong>every</strong> field you fill in. Leave a field
          empty to mean "any". Suppressed findings are dropped, so nothing downstream — the alert list, the
          webhook, the SIEM feed — will ever see them.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            select
            label={t('suppressions.kind')}
            size="small"
            value={draft.kind ?? ''}
            onChange={(event) => set('kind', (event.target.value || null) as AlertKind | null)}
            helperText={t('suppressions.kind_helper')}
          >
            <MenuItem value="">{t('common.any_kind')}</MenuItem>
            {ALERT_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {kindLabel(kind)}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('suppressions.source')}
              size="small"
              fullWidth
              value={draft.sourceCidr ?? ''}
              onChange={(event) => set('sourceCidr', event.target.value.trim() || null)}
              placeholder="10.20.30.40 or 10.20.30.0/24"
              helperText={t('suppressions.source_helper')}
            />
            <TextField
              label={t('suppressions.target')}
              size="small"
              fullWidth
              value={draft.targetCidr ?? ''}
              onChange={(event) => set('targetCidr', event.target.value.trim() || null)}
              placeholder="192.168.1.0/24"
              helperText={t('suppressions.target_helper')}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('suppressions.port')}
              size="small"
              fullWidth
              type="number"
              value={draft.port ?? ''}
              onChange={(event) => set('port', event.target.value === '' ? null : Number(event.target.value))}
              // The honest caveat, next to the field rather than in documentation
              // nobody reads: a port scan names no single port, so a rule with a
              // port will never match one.
              helperText={t('suppressions.port_helper')}
            />
            <TextField
              label={t('suppressions.expires')}
              size="small"
              fullWidth
              type="datetime-local"
              value={toLocalInput(draft.expiresAt)}
              onChange={(event) => set('expiresAt', fromLocalInput(event.target.value))}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText={t('suppressions.expires_helper')}
            />
          </Stack>

          <TextField
            label={t('suppressions.reason')}
            size="small"
            required
            multiline
            minRows={2}
            value={draft.reason}
            onChange={(event) => set('reason', event.target.value)}
            placeholder={t('suppressions.reason_placeholder')}
            helperText={t('suppressions.reason_helper')}
          />

          <FormControlLabel
            control={
              <Switch checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} />
            }
            label={t('suppressions.in_force')}
          />

          <Box>
            <Button
              size="small"
              variant="text"
              disabled={!hasCriterion || preview.isPending}
              onClick={() => preview.mutate()}
            >
              {preview.isPending ? 'Checking…' : 'Check against recent alerts'}
            </Button>

            {preview.data && (
              <Alert
                // Nothing matched is a warning, not a success: the usual cause is a
                // range that does not cover what the operator thinks it does.
                severity={preview.data.matched === 0 ? 'warning' : 'info'}
                sx={{ mt: 1 }}
              >
                <Typography variant="body2">
                  {preview.data.matched === 0
                    ? t('suppressions.preview_none', {
                        examined: fmt.number(preview.data.examined),
                      })
                    : t('suppressions.preview_matched', {
                        matched: fmt.number(preview.data.matched),
                        examined: fmt.number(preview.data.examined),
                        occurrences: fmt.number(preview.data.occurrences),
                      })}
                </Typography>
                {preview.data.window && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                    {t('suppressions.preview_window', {
                      from: fmt.dateTime(preview.data.window.from),
                      to: fmt.dateTime(preview.data.window.to),
                    })}
                  </Typography>
                )}
                {preview.data.samples.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    {preview.data.samples.slice(0, 5).map((sample) => (
                      <Typography key={sample.id} variant="caption" sx={{ display: 'block' }}>
                        {kindLabel(sample.kind)} · {sample.sourceIp ?? 'unknown'}
                        {sample.targetIp ? ` → ${sample.targetIp}` : ''} ·{' '}
                        {sample.occurrences.toLocaleString()}×
                      </Typography>
                    ))}
                  </Box>
                )}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          // Both conditions are enforced by the server too; disabling here is so
          // the operator is not told off after typing a reason.
          disabled={save.isPending || !hasCriterion || draft.reason.trim().length < 3}
        >
          {save.isPending ? 'Saving…' : rule ? 'Save changes' : 'Create rule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * ISO to the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, in local time.
 *
 * Slicing the ISO string would be shorter and wrong: it is UTC, so an operator in
 * any other zone would see a time that is not the one they set.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The inverse. Empty clears the expiry rather than sending an Invalid Date. */
function fromLocalInput(value: string): string | null {
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
