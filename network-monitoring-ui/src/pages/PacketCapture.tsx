import { useState } from 'react';
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
  /*
   * Bumped when the capture settings finish folding.
   *
   * The packet table measures its own height, and that measurement watches for
   * RESIZE — which cannot see the card above it getting shorter, since nothing
   * about the table changes size; its top edge just rises. Bumping on the
   * settled layout rather than on the toggle is what makes the reading true: a
   * measurement taken mid-animation reads a half-folded toolbar.
   */
  const [layoutSettled, setLayoutSettled] = useState(0);

  return (
    <>
      <CaptureToolbar
        title="Capture from a local interface"
        subtitle="Live packets from one adapter, decoded frame by frame"
        capture={capture}
        onLayoutSettled={() => setLayoutSettled((tick) => tick + 1)}
      />

      <SurfaceCard title="Packets" subtitle="Newest first, decoded from the wire" bodyVariant="grid">
        <PacketTable
          packets={capture.packets}
          capturing={capture.capturing}
          onIpClick={ipInfo.show}
          fitHeightDeps={[layoutSettled]}
        />
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
