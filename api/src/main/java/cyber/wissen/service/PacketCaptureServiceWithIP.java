package cyber.wissen.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import org.pcap4j.core.BpfProgram;
import org.pcap4j.core.NotOpenException;
import org.pcap4j.core.PcapHandle;
import org.pcap4j.core.PcapNativeException;
import org.pcap4j.core.PcapNetworkInterface;
import org.pcap4j.core.Pcaps;
import org.pcap4j.packet.EthernetPacket;
import org.pcap4j.packet.IpV4Packet;
import org.pcap4j.packet.IpV6Packet;
import org.pcap4j.packet.LlcPacket;
import org.pcap4j.packet.Packet;
import org.pcap4j.packet.TcpPacket;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import cyber.wissen.dto.EthernetHeaderDTO;
import cyber.wissen.dto.LlcHeaderDTO;
import cyber.wissen.dto.NetworkInterfaceDTO;
import cyber.wissen.dto.PacketDTO;
import cyber.wissen.entity.Log;

@Service
public class PacketCaptureServiceWithIP {

    private PcapHandle handle;
    private boolean capturing = false;
    private List<Packet> capturedPackets = new ArrayList<>();
    private String filterIpAddress;

    @Autowired
    private LogService logService;

    // Set the IP address to filter
    public void setFilterIpAddress(String ipAddress) {
        this.filterIpAddress = ipAddress;
    }

    // Get available Network Interface
    public List<NetworkInterfaceDTO> getNetworkInterfaces() throws PcapNativeException {
        List<PcapNetworkInterface> allDevs = Pcaps.findAllDevs();
        List<NetworkInterfaceDTO> networkInterfaces = new ArrayList<>();
        
        for (PcapNetworkInterface dev : allDevs) {
            networkInterfaces.add(new NetworkInterfaceDTO(dev.getName(), dev.getDescription()));
        }
        
        return networkInterfaces;
    }
    
    // Start capturing packets from a specific interface with a filter
    public void startCapture(String interfaceName, int snapshotLength, int timeout) throws NotOpenException {
        if (capturing) return;

        try {
            PcapNetworkInterface nif = Pcaps.getDevByName(interfaceName);
            if (nif == null) {
                throw new IllegalArgumentException("No such interface found: " + interfaceName);
            }

            handle = nif.openLive(snapshotLength, PcapNetworkInterface.PromiscuousMode.PROMISCUOUS, timeout);

            // Apply a filter if an IP address is set
            if (filterIpAddress != null && !filterIpAddress.isEmpty()) {
                String filter = "host " + filterIpAddress;
                handle.setFilter(filter, BpfProgram.BpfCompileMode.OPTIMIZE);
            }

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
        capturedPackets.add(packet);
        if (isAnomalous(packet)) {
            logService.saveLog(createLogFromPacket(packet));
        }
    }

    private boolean isAnomalous(Packet packet) {
        int packetLength = packet.length();
        
        // Check for unusually large or small packet sizes
        if (packetLength > 1500 || packetLength < 64) {
            return true;
        }
        
        IpV4Packet ipV4Packet = packet.get(IpV4Packet.class);
        if (ipV4Packet != null) {
            // Check for uncommon protocols
            int protocolNumber = ipV4Packet.getHeader().getProtocol().value();
            if (protocolNumber != 6 && protocolNumber != 17 && protocolNumber != 1) {
                return true;
            }
    
            // Example: Detect SYN flood by checking if the SYN flag is set without ACK
            TcpPacket tcpPacket = packet.get(TcpPacket.class);
            if (tcpPacket != null && tcpPacket.getHeader().getSyn() && !tcpPacket.getHeader().getAck()) {
                return true;
            }
        }
        
        IpV6Packet ipV6Packet = packet.get(IpV6Packet.class);
        if (ipV6Packet != null) {
            // Check for uncommon protocols
            int protocolNumber = ipV6Packet.getHeader().getProtocol().value();
            if (protocolNumber != 6 && protocolNumber != 17 && protocolNumber != 1) {
                return true;
            }
    
            // Example: Detect SYN flood by checking if the SYN flag is set without ACK
            TcpPacket tcpPacket = packet.get(TcpPacket.class);
            if (tcpPacket != null && tcpPacket.getHeader().getSyn() && !tcpPacket.getHeader().getAck()) {
                return true;
            }
        }
        
        // Further anomaly detection logic can be added here
        
        return false;
    }

    private Log createLogFromPacket(Packet packet) {
        Log log = new Log();
    
        // Extract IP addresses
        IpV4Packet ipV4Packet = packet.get(IpV4Packet.class);
        IpV6Packet ipV6Packet = packet.get(IpV6Packet.class);
        if (ipV4Packet != null) {
            log.setSourceip(ipV4Packet.getHeader().getSrcAddr().getHostAddress());
            log.setDestinationip(ipV4Packet.getHeader().getDstAddr().getHostAddress());
        } else {
            if (ipV6Packet != null) {
                log.setSourceip(ipV6Packet.getHeader().getSrcAddr().getHostAddress());
                log.setDestinationip(ipV6Packet.getHeader().getDstAddr().getHostAddress());
            }
        }
    
        EthernetPacket ethernetPacket = packet.get(EthernetPacket.class);
        if (ethernetPacket != null && (ipV4Packet != null || ipV6Packet != null )) {
            log.setSourcemac(ethernetPacket.getHeader().getSrcAddr().toString());
            log.setDestinationmac(ethernetPacket.getHeader().getDstAddr().toString());
            log.setIpversion(ethernetPacket.getHeader().getType().toString());
        }
    
        log.setProtocol(getProtocol(packet));
    
        // Convert packet to string and truncate if necessary
        String details = packet.toString();
        if (details.length() > 2000) {
            details = details.substring(0, 2000);
        }
        log.setDetails(details);
    
        log.setTimestamp(LocalDateTime.now());
    
        return log;
    }

    private PacketDTO createPacketDTO(Packet packet) {
        PacketDTO packetDTO = new PacketDTO();

        // Ethernet header extraction (as you already have)
        EthernetPacket ethernetPacket = packet.get(EthernetPacket.class);
        EthernetHeaderDTO ethernetHeaderDTO = new EthernetHeaderDTO();
        ethernetHeaderDTO.setDestinationAddress(ethernetPacket.getHeader().getDstAddr().toString());
        ethernetHeaderDTO.setSourceAddress(ethernetPacket.getHeader().getSrcAddr().toString());
        ethernetHeaderDTO.setType(ethernetPacket.getHeader().getType().toString());
        packetDTO.setEthernetHeader(ethernetHeaderDTO);

        // Extract IP addresses
        IpV4Packet ipV4Packet = packet.get(IpV4Packet.class);
        if (ipV4Packet != null) {
            String srcIp = ipV4Packet.getHeader().getSrcAddr().getHostAddress();
            String dstIp = ipV4Packet.getHeader().getDstAddr().getHostAddress();
            packetDTO.setSourceIpAddress(srcIp);
            packetDTO.setDestinationIpAddress(dstIp);
        } else {
            IpV6Packet ipV6Packet = packet.get(IpV6Packet.class);
            if (ipV6Packet != null) {
                String srcIp = ipV6Packet.getHeader().getSrcAddr().getHostAddress();
                String dstIp = ipV6Packet.getHeader().getDstAddr().getHostAddress();
                packetDTO.setSourceIpAddress(srcIp);
                packetDTO.setDestinationIpAddress(dstIp);
            }
        }

        // LLC and other data processing (if needed)
        LlcPacket llcPacket = packet.get(LlcPacket.class);
        if (llcPacket != null) {
            LlcHeaderDTO llcHeaderDTO = new LlcHeaderDTO();
            llcHeaderDTO.setDsap(llcPacket.getHeader().getDsap().toString());
            llcHeaderDTO.setSsap(llcPacket.getHeader().getSsap().toString());
            llcHeaderDTO.setControl(llcPacket.getHeader().getControl().toString());
            packetDTO.setLlcHeader(llcHeaderDTO);
        }

        packetDTO.setDataHexStream(toHexStream(packet.getRawData()));
        packetDTO.setEthernetPadHexStream(extractEthernetPadHexStream(packet));

        return packetDTO;
    }

    private String toHexStream(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (byte b : data) {
            sb.append(String.format("%02x ", b));
        }
        return sb.toString().trim();
    }

    private String extractEthernetPadHexStream(Packet packet) {
        byte[] padData = extractEthernetPad(packet);
        return toHexStream(padData);
    }

    private byte[] extractEthernetPad(Packet packet) {
        EthernetPacket ethernetPacket = packet.get(EthernetPacket.class);
        byte[] rawData = ethernetPacket.getRawData();

        int ethernetHeaderLength = 14;
        int ipHeaderLength = 20;
        int tcpHeaderLength = 20;

        int totalPacketLength = packet.getRawData().length;
        int padStartIndex = ethernetHeaderLength + ipHeaderLength + tcpHeaderLength;
        int paddingThreshold = 64;
        int padLength = (totalPacketLength < paddingThreshold) ? paddingThreshold - totalPacketLength : 0;

        if (padStartIndex < 0 || padStartIndex + padLength > rawData.length) {
            return new byte[0];
        }

        byte[] padData = new byte[padLength];
        System.arraycopy(rawData, padStartIndex, padData, 0, padLength);

        return padData;
    }

    public List<PacketDTO> getCapturedPackets() {
        return capturedPackets.stream().map(this::createPacketDTO).collect(Collectors.toList());
    }

    public void clearCapturedPackets() {
        capturedPackets.clear();
    }

    // extract protocol information from IP
   private String getProtocol(Packet packet) {
      IpV4Packet ipV4Packet = packet.get(IpV4Packet.class);
      if (ipV4Packet != null) {
          return ipV4Packet.getHeader().getProtocol().name();
      } else {
          IpV6Packet ipV6Packet = packet.get(IpV6Packet.class);
          if (ipV6Packet != null) {
              return ipV6Packet.getHeader().getNextHeader().name();
          }
      }
      return "Unknown Protocol";
   }
}

