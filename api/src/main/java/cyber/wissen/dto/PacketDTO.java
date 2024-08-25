package cyber.wissen.dto;


public class PacketDTO {
    private EthernetHeaderDTO ethernetHeader;
    private LlcHeaderDTO llcHeader;
    private String dataHexStream;
    private String ethernetPadHexStream;
    private String sourceIpAddress;
    private String destinationIpAddress;

    // Getters and setters for the above fields


    public EthernetHeaderDTO getEthernetHeader() {
        return this.ethernetHeader;
    }

    public void setEthernetHeader(EthernetHeaderDTO ethernetHeader) {
        this.ethernetHeader = ethernetHeader;
    }

    public LlcHeaderDTO getLlcHeader() {
        return this.llcHeader;
    }

    public void setLlcHeader(LlcHeaderDTO llcHeader) {
        this.llcHeader = llcHeader;
    }

    public String getDataHexStream() {
        return this.dataHexStream;
    }

    public void setDataHexStream(String dataHexStream) {
        this.dataHexStream = dataHexStream;
    }

    public String getEthernetPadHexStream() {
        return this.ethernetPadHexStream;
    }

    public void setEthernetPadHexStream(String ethernetPadHexStream) {
        this.ethernetPadHexStream = ethernetPadHexStream;
    }


    public String getSourceIpAddress() {
        return this.sourceIpAddress;
    }

    public void setSourceIpAddress(String sourceIpAddress) {
        this.sourceIpAddress = sourceIpAddress;
    }

    public String getDestinationIpAddress() {
        return this.destinationIpAddress;
    }

    public void setDestinationIpAddress(String destinationIpAddress) {
        this.destinationIpAddress = destinationIpAddress;
    }

}


