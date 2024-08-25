package cyber.wissen.service;

import java.nio.charset.StandardCharsets;

import org.pcap4j.packet.IpV4Packet;
import org.pcap4j.packet.Packet;
import org.pcap4j.packet.TcpPacket;

public class PacketParser {

    public String parsePacket(Packet packet) {
        IpV4Packet ipV4Packet = packet.get(IpV4Packet.class);
        if (ipV4Packet != null) {
            TcpPacket tcpPacket = ipV4Packet.get(TcpPacket.class);
            if (tcpPacket != null) {
                byte[] payload = tcpPacket.getPayload().getRawData();
                // Try to interpret payload as a string
                String payloadStr = new String(payload, StandardCharsets.UTF_8);
                // Check if the payload contains HTTP content
                if (payloadStr.contains("HTTP")) {
                    return payloadStr; // This should return the readable HTTP data
                } else {
                    return formatAsReadable(payload); // Non-HTTP data in readable format
                }
            }
        }
        return formatAsReadable(packet.getRawData());
    }

    public String formatAsReadable(byte[] data) {
        StringBuilder sb = new StringBuilder();

        for (byte b : data) {
            if (b >= 32 && b <= 126) {
                sb.append((char) b);
            } else {
                sb.append(String.format("\\x%02X", b));
            }
        }

        return sb.toString();
    }
}
