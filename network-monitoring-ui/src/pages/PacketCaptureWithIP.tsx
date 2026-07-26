import Typography from '@mui/material/Typography';
import CaptureToolbar from '../components/CaptureToolbar';
import IpInfoDialog from '../components/IpInfoDialog';
import PacketTable from '../components/PacketTable';
import { useIpInfo } from '../hooks/useIpInfo';
import { usePacketCapture } from '../hooks/usePacketCapture';

/** Was pages/PacketCaptureWithIP.js — same page, plus a `host <ip>` BPF filter. */
export default function PacketCaptureWithIP() {
  const capture = usePacketCapture('filtered-ip');
  const ipInfo = useIpInfo();

  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom>
        Capture filtered by IP address
      </Typography>

      <CaptureToolbar capture={capture} showIpFilter />

      <PacketTable
        packets={capture.packets}
        capturing={capture.capturing}
        onIpClick={(ipAddress) => void ipInfo.show(ipAddress)}
      />

      <IpInfoDialog
        open={ipInfo.open}
        ipAddress={ipInfo.ipAddress}
        info={ipInfo.info}
        loading={ipInfo.loading}
        error={ipInfo.error}
        onClose={ipInfo.close}
      />
    </>
  );
}
