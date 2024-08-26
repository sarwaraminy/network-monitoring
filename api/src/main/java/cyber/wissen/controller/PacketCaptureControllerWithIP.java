package cyber.wissen.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.json.JSONObject;
import org.pcap4j.core.PcapNativeException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cyber.wissen.dto.NetworkInterfaceDTO;
import cyber.wissen.dto.PacketDTO;
import cyber.wissen.networkservice.IPGeolocationService;
import cyber.wissen.networkservice.IPInfoService;
import cyber.wissen.networkservice.IPWhoisService;
import cyber.wissen.service.PacketCaptureServiceWithIP;

@RestController
@RequestMapping("/api/ip/packets")
public class PacketCaptureControllerWithIP {

    @Autowired
    private PacketCaptureServiceWithIP packetCaptureServiceWithIP;

    @Autowired
    private IPInfoService ipInfoService;

    @Autowired
    private IPWhoisService whoisService;

    @Autowired
    private IPGeolocationService geoService;

    // Start capturing packets from a specific IP address
    @PostMapping("/start")
    public ResponseEntity<Void> startCapture(@RequestParam String ipAddress, @RequestParam String interfaceName) {
        try {
            packetCaptureServiceWithIP.setFilterIpAddress(ipAddress);  // Set the IP address filter
            packetCaptureServiceWithIP.startCapture(interfaceName);     // Start capture on the specified interface
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            e.printStackTrace(); // Log the exception for debugging
            return ResponseEntity.status(500).body(null);
        }
    }

    @PostMapping("/stop")
    public ResponseEntity<Void> stopCapture() {
        packetCaptureServiceWithIP.stopCapture();
        return ResponseEntity.ok().build();
    }

    @GetMapping
    public ResponseEntity<List<PacketDTO>> getCapturedPackets() {
        return ResponseEntity.ok(packetCaptureServiceWithIP.getCapturedPackets());
    }

    // Clear the stored data
    @PostMapping("/clear")
    public ResponseEntity<Void> clearCapturedPackets() {
        packetCaptureServiceWithIP.clearCapturedPackets();
        return ResponseEntity.noContent().build(); // 204 No Content
    }

    // Get available network interface
    @GetMapping("/nif")
    public List<NetworkInterfaceDTO> getNetworkInterfaces() throws PcapNativeException {
        return packetCaptureServiceWithIP.getNetworkInterfaces();
    }

    // Get detailed IP information
    @GetMapping("/ip-info")
    public ResponseEntity<Map<String, Object>> getIPInformation(@RequestParam String ipAddress) {
        try {
            String domainName = ipInfoService.getDomainName(ipAddress);
            String whoisData = whoisService.getWhoisData(ipAddress);
            JSONObject geoData = geoService.getGeolocationData(ipAddress);

            Map<String, Object> response = new HashMap<>();
            response.put("ipAddress", ipAddress);
            response.put("domainName", domainName);
            response.put("whoisData", whoisData);
            response.put("geoData", geoData.toMap());  // Converts JSONObject to Map for JSON serialization

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            e.printStackTrace(); // Log the exception for debugging
            return ResponseEntity.status(500).body(null);
        }
    }
}

