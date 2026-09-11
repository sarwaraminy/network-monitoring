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
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MRT_ColumnDef } from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { describeError } from '../api/client';
import { deleteSuppression, fetchSuppressions, updateSuppression } from '../api/suppressions.api';
import DataGrid, { numericColumn } from '../components/DataGrid';
import StatTile from '../components/StatTile';
import SuppressionRuleDialog, { kindLabel } from '../components/SuppressionRuleDialog';
import SurfaceCard from '../components/SurfaceCard';
import { useAuth } from '../contexts/AuthContext';
import { useFormatters } from '../i18n/format';
import { type Message, useMessageText } from '../i18n/message-state';
import { type Translate, type UiMessageKey, useT } from '../i18n/ui';
import type { SuppressionRule } from '../types';

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
  { labelKey: UiMessageKey; color: 'success' | 'default' | 'warning' | 'error'; hintKey: UiMessageKey }
> = {
  active: {
    labelKey: 'suppressions.state.active',
    color: 'success',
    hintKey: 'suppressions.state.active_hint',
  },
  disabled: {
    labelKey: 'suppressions.state.disabled',
    color: 'default',
    hintKey: 'suppressions.state.disabled_hint',
  },
  expired: {
    labelKey: 'suppressions.state.expired',
    color: 'warning',
    hintKey: 'suppressions.state.expired_hint',
  },
  invalid: {
    labelKey: 'suppressions.state.invalid',
    color: 'error',
    hintKey: 'suppressions.state.invalid_hint',
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

/** One line describing what a rule covers, in the order an operator reads it. */
function describeRule(rule: SuppressionRule, t: Translate): string {
  const parts: string[] = [];
  parts.push(rule.kind ? kindLabel(rule.kind, t) : t('suppressions.any_finding'));
  if (rule.sourceCidr) parts.push(t('suppressions.rule_from', { cidr: rule.sourceCidr }));
  if (rule.targetCidr) parts.push(t('suppressions.rule_to', { cidr: rule.targetCidr }));
  if (rule.port !== null) parts.push(t('suppressions.rule_port', { port: rule.port }));
  return parts.join(' ');
}

export default function SuppressionsPage() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<{ rule: SuppressionRule | null } | null>(null);
  // What to say, not the words for it — see i18n/message-state.ts.
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; body: Message } | null>(null);
  const messageText = useMessageText();

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
        body: {
          key: updated.enabled ? 'suppressions.enabled_toast' : 'suppressions.disabled_toast',
          params: { id: updated.id },
        },
      });
      refresh();
    },
    onError: (error) =>
      setMessage({ severity: 'error', body: { error, fallbackKey: 'suppressions.update_failed' } }),
  });

  const remove = useMutation({
    mutationFn: (rule: SuppressionRule) => deleteSuppression(rule.id),
    onSuccess: () => {
      setMessage({ severity: 'success', body: { key: 'suppressions.deleted_toast' } });
      refresh();
    },
    onError: (error) =>
      setMessage({ severity: 'error', body: { error, fallbackKey: 'suppressions.delete_failed' } }),
  });

  const handleEdit = useCallback((rule: SuppressionRule) => setEditing({ rule }), []);
  const handleToggle = useCallback((rule: SuppressionRule) => toggle.mutate({ rule }), [toggle]);
  const handleDelete = useCallback(
    (rule: SuppressionRule) => {
      // Deliberately a confirm rather than an undo: deleting discards the match
      // count, which is the only record of what the rule hid.
      if (
        window.confirm(
          t('suppressions.confirm_delete', {
            id: rule.id,
            count: rule.matchCount,
          }),
        )
      ) {
        remove.mutate(rule);
      }
    },
    [remove, t],
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
        <Alert severity="error">{describeError(listing.error, t('suppressions.read_failed'))}</Alert>
      )}

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {messageText(message.body)}
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
          {t('suppressions.invalid_warning', { count: invalid.size })}
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
            caption={t('suppressions.in_force_count', { count: inForce })}
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
        <SuppressionRuleDialog
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            setMessage({
              severity: 'success',
              body: {
                key: created ? 'suppressions.created_toast' : 'suppressions.updated_toast',
                params: { id: saved.id },
              },
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
        // `t` is closed over rather than passed by MRT, which calls the accessor
        // with the row alone.
        accessorFn: (rule: SuppressionRule) => describeRule(rule, t),
        Cell: ({ row }) => (
          <>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {describeRule(row.original, t)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              #{row.original.id}
              {t('suppressions.added_by')}
              {row.original.createdBy}
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
        accessorFn: (rule) => t(STATE[ruleState(rule, invalid, now)].labelKey),
        filterVariant: 'select',
        // Built explicitly, or MRT faces the raw accessor values and the dropdown
        // drifts from what the chips say.
        filterSelectOptions: Object.values(STATE).map((state) => t(state.labelKey)),
        Cell: ({ row }) => {
          const state = STATE[ruleState(row.original, invalid, now)];
          // The server's own reason beats the generic hint when there is one.
          const reason = invalid.get(row.original.id);
          return (
            <Tooltip title={reason ? `${reason}. ${t(state.hintKey)}` : t(state.hintKey)}>
              <Chip size="small" variant="outlined" color={state.color} label={t(state.labelKey)} />
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
                {fmt.number(count)}
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
                <IconButton
                  size="small"
                  aria-label={t('suppressions.edit_rule', { id: rule.id })}
                  onClick={() => onEdit(rule)}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip
                title={rule.enabled ? t('suppressions.switch_off_hint') : t('suppressions.switch_on_hint')}
              >
                <IconButton
                  size="small"
                  aria-label={t('suppressions.toggle_rule', { enabled: rule.enabled, id: rule.id })}
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
                <IconButton
                  size="small"
                  aria-label={t('suppressions.delete_rule', { id: rule.id })}
                  onClick={() => onDelete(rule)}
                >
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
          muiSearchTextFieldProps: { placeholder: t('suppressions.search'), sx: { minWidth: 180 } },
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
