import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useFormatters } from '../i18n/format';
import { useT } from '../i18n/ui';
import { type AlertSummary, SEVERITIES, type Severity } from '../types';
import { SEVERITY_STYLE } from './SeverityChip';

interface AlertSummaryTilesProps {
  summary: AlertSummary | null;
  selected: Severity | 'all';
  onSelect: (severity: Severity | 'all') => void;
}

/**
 * Severity counts across the top of the alerts page, doubling as filters.
 *
 * The severity split is the thing an operator needs first: two critical findings
 * matter more than four hundred informational ones, which is exactly the
 * distinction the old flat log could not express.
 */
export default function AlertSummaryTiles({ summary, selected, onSelect }: Readonly<AlertSummaryTilesProps>) {
  const t = useT();
  const fmt = useFormatters();
  const tiles: Array<{ key: Severity | 'all'; label: string; value: number; hex: string }> = [
    { key: 'all', label: t('alerts.tile.all'), value: summary?.total ?? 0, hex: '#1d4ed8' },
    ...SEVERITIES.map((severity) => ({
      key: severity,
      label: t(SEVERITY_STYLE[severity].labelKey),
      value: summary?.bySeverity[severity] ?? 0,
      hex: SEVERITY_STYLE[severity].hex,
    })),
  ];

  return (
    <Grid container spacing={1.5}>
      {tiles.map((tile) => {
        const active = selected === tile.key;
        const muted = tile.value === 0 && !active;
        return (
          <Grid size={{ xs: 6, sm: 4, md: 2 }} key={tile.key}>
            <Card
              variant="outlined"
              sx={{
                borderColor: active ? tile.hex : undefined,
                borderWidth: active ? 2 : 1,
                bgcolor: active ? `${tile.hex}0a` : undefined,
              }}
            >
              <CardActionArea onClick={() => onSelect(tile.key)} sx={{ p: 1.5 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'center',
                  }}
                >
                  <Box
                    sx={{
                      width: 6,
                      height: 34,
                      borderRadius: 3,
                      bgcolor: tile.hex,
                      opacity: muted ? 0.25 : 1,
                    }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="h6"
                      sx={{ lineHeight: 1.1, color: muted ? 'text.disabled' : 'text.primary' }}
                    >
                      {fmt.number(tile.value)}
                    </Typography>
                    <Typography
                      variant="caption"
                      noWrap
                      sx={{
                        color: 'text.secondary',
                      }}
                    >
                      {tile.label}
                    </Typography>
                  </Box>
                </Stack>
              </CardActionArea>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}
