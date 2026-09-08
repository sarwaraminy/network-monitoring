import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { describeError } from '../api/client';
import { fetchIpInfo } from '../api/packets.api';
import { queryKeys } from '../api/queryClient';
import { useT } from '../i18n/ui';

/**
 * Drives IpInfoDialog.
 *
 * The lookup is cached per address, so reopening the dialog for an address already
 * inspected is instant instead of re-running reverse DNS, WHOIS and a
 * third-party geolocation call.
 */
export function useIpInfo() {
  const t = useT();
  const [ipAddress, setIpAddress] = useState('');
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.ipInfo(ipAddress),
    queryFn: () => fetchIpInfo(ipAddress),
    // Only run once the dialog has an address to look up.
    enabled: open && ipAddress !== '',
    // WHOIS and geolocation records barely move; no need to ask twice.
    staleTime: 10 * 60_000,
  });

  const show = useCallback((address: string) => {
    setIpAddress(address);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return {
    ipAddress,
    info: query.data ?? null,
    open,
    loading: query.isPending && open && ipAddress !== '',
    error: query.error ? describeError(query.error, t('ipinfo.lookup_of_failed', { ipAddress })) : '',
    show,
    close,
  };
}
