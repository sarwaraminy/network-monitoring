import CaptureToolbar from '../components/CaptureToolbar';
import IpInfoDialog from '../components/IpInfoDialog';
import PacketTable from '../components/PacketTable';
import SurfaceCard from '../components/SurfaceCard';
import { useIpInfo } from '../hooks/useIpInfo';
import { usePacketCapture } from '../hooks/usePacketCapture';

/** Was pages/PacketCaptureWithIP.js — same page, plus a `host <ip>` BPF filter. */
export default function PacketCaptureWithIP() {
  const capture = usePacketCapture('filtered-ip');
  const ipInfo = useIpInfo();

  return (
    <>
      <CaptureToolbar
        title="Capture filtered by IP address"
        subtitle="The same capture, narrowed to traffic involving one host"
        capture={capture}
        showIpFilter
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
