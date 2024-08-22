package cyber.wissen.controller;

import java.util.List;

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
import cyber.wissen.service.PacketCaptureService;

@RestController
@RequestMapping("/api/packets")
public class PacketCaptureController {

    @Autowired
    private PacketCaptureService packetCaptureService;

    @PostMapping("/start")
    public ResponseEntity<Void> startCapture(@RequestParam String interfaceName) {
        try {
            packetCaptureService.startCapture(interfaceName);
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            return ResponseEntity.status(500).body(null);
        }
    }

    @PostMapping("/stop")
    public ResponseEntity<Void> stopCapture() {
        packetCaptureService.stopCapture();
        return ResponseEntity.ok().build();
    }

    @GetMapping
    public ResponseEntity<List<PacketDTO>> getCapturedPackets() {
        return ResponseEntity.ok(packetCaptureService.getCapturedPackets());
    }

    // clear the stored data
    @PostMapping("/clear")
    public ResponseEntity<Void> clearCapturedPackets() {
        packetCaptureService.clearCapturedPackets();
        return ResponseEntity.noContent().build(); // 204 No Content
    }

    // Get available network interface
    @GetMapping("/nif")
    public List<NetworkInterfaceDTO> getNetworkInterfaces() throws PcapNativeException {
        return packetCaptureService.getNetworkInterfaces();
    }
    
}

