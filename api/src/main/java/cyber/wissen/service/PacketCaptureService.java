package cyber.wissen.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import org.pcap4j.core.NotOpenException;
import org.pcap4j.core.PcapHandle;
import org.pcap4j.core.PcapNativeException;
import org.pcap4j.core.PcapNetworkInterface;
import org.pcap4j.core.Pcaps;
import org.pcap4j.packet.Packet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import cyber.wissen.entity.Log;

@Service
public class PacketCaptureService {

    private PcapHandle handle;
    private boolean capturing = false;
    private List<Packet> capturedPackets = new ArrayList<>();

    @Autowired
    private LogService logService;

    public void startCapture(String interfaceName) {
        if (capturing) return;

        try {
            PcapNetworkInterface nif = Pcaps.getDevByName(interfaceName);
            if (nif == null) {
                throw new IllegalArgumentException("No such interface found: " + interfaceName);
            }

            int snapshotLength = 65536; // Capture all packets, no truncation
            int timeout = 10; // In milliseconds
            handle = nif.openLive(snapshotLength, PcapNetworkInterface.PromiscuousMode.PROMISCUOUS, timeout);

            capturing = true;
            new Thread(() -> {
                try {
                    handle.loop(-1, this::processPacket);
                } catch (InterruptedException e) {
                    e.printStackTrace(); // Handle thread interruption
                } catch (PcapNativeException | NotOpenException e) {
                    e.printStackTrace(); // Handle errors related to packet capture
                }
            }).start();
        } catch (PcapNativeException e) {
            e.printStackTrace(); // Handle errors during handle initialization
        }
    }

    public void stopCapture() {
        if (handle != null && handle.isOpen()) {
            try {
                handle.breakLoop();
            } catch (NotOpenException e) {
                e.printStackTrace(); // Handle if the handle is not open when trying to break the loop
            }
            handle.close();
        }
        capturing = false;
    }

    private void processPacket(Packet packet) {
        System.out.println(packet);
        capturedPackets.add(packet);
        if (isAnomalous(packet)) {
            logService.saveLog(createLogFromPacket(packet));
        }
    }

    private boolean isAnomalous(Packet packet) {
        // Implement anomaly detection logic
        return packet.length() > 1500; // Example anomaly detection
    }

    private Log createLogFromPacket(Packet packet) {
        Log log = new Log();
        log.setPacketData(packet.getRawData());
        log.setTimestamp(LocalDateTime.now());
        return log;
    }

    public List<Packet> getCapturedPackets() {
        return new ArrayList<>(capturedPackets);
    }
}
