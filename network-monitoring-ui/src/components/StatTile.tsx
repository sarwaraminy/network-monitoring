import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

interface StatTileProps {
  label: string;
  value: number | string;
  /** Short qualifier under the value, e.g. "in the last 7 days". */
  caption?: string;
  icon?: ReactNode;
  /** Accent bar colour. Defaults to a recessive divider. */
  accent?: string;
  onClick?: () => void;
  loading?: boolean;
}

/**
 * A single headline number.
 *
 * The data-viz guidance is explicit that one current value belongs in a stat tile
 * rather than a one-bar bar chart — a bar encodes comparison, and there is nothing
 * here to compare against.
 *
 * The value uses proportional figures; tabular figures are reserved for columns
 * that must align vertically, which these do not.
 */
export default function StatTile({
  label,
  value,
  caption,
  icon,
  accent,
  onClick,
  loading = false,
}: StatTileProps) {
  const body = (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 2 }}>
      <Box
        sx={{
          width: 6,
          alignSelf: 'stretch',
          minHeight: 44,
          borderRadius: 3,
          bgcolor: accent ?? 'divider',
          flexShrink: 0,
        }}
      />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {label}
        </Typography>
        {loading ? (
          <Skeleton width={72} height={34} />
        ) : (
          <Typography variant="h5" component="p" sx={{ lineHeight: 1.15 }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </Typography>
        )}
        {caption && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {caption}
          </Typography>
        )}
      </Box>
      {icon && <Box sx={{ color: 'text.disabled', display: 'flex' }}>{icon}</Box>}
    </Stack>
  );

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {onClick ? <CardActionArea onClick={onClick}>{body}</CardActionArea> : body}
    </Card>
  );
}
