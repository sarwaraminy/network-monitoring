import Typography from '@mui/material/Typography';
import CaptureToolbar from '../components/CaptureToolbar';
import IpInfoDialog from '../components/IpInfoDialog';
import PacketTable from '../components/PacketTable';
import { useIpInfo } from '../hooks/useIpInfo';
import { usePacketCapture } from '../hooks/usePacketCapture';

/** Was pages/PacketCapture.js — captures everything on the chosen interface. */
export default function PacketCapture() {
  const capture = usePacketCapture('interface');
  const ipInfo = useIpInfo();

  return (
    <>
      <Typography variant="h5" component="h1" gutterBottom>
        Capture from a local interface
      </Typography>

      <CaptureToolbar capture={capture} />

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
