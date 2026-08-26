import CaptureToolbar from '../components/CaptureToolbar';
import IpInfoDialog from '../components/IpInfoDialog';
import PacketTable from '../components/PacketTable';
import SurfaceCard from '../components/SurfaceCard';
import { useIpInfo } from '../hooks/useIpInfo';
import { usePacketCapture } from '../hooks/usePacketCapture';

/** Was pages/PacketCapture.js — captures everything on the chosen interface. */
export default function PacketCapture() {
  const capture = usePacketCapture('interface');
  const ipInfo = useIpInfo();

  return (
    <>
      <CaptureToolbar
        title="Capture from a local interface"
        subtitle="Live packets from one adapter, decoded frame by frame"
        capture={capture}
      />

      <SurfaceCard title="Packets" subtitle="Newest first, decoded from the wire" bodyVariant="grid">
        <PacketTable packets={capture.packets} capturing={capture.capturing} onIpClick={ipInfo.show} />
      </SurfaceCard>

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
