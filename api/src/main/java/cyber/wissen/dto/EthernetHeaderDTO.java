package cyber.wissen.dto;

public class EthernetHeaderDTO {
    private String destinationAddress;
    private String sourceAddress;
    private String type;
    
    // Getters and setters

    public String getDestinationAddress() {
        return this.destinationAddress;
    }

    public void setDestinationAddress(String destinationAddress) {
        this.destinationAddress = destinationAddress;
    }

    public String getSourceAddress() {
        return this.sourceAddress;
    }

    public void setSourceAddress(String sourceAddress) {
        this.sourceAddress = sourceAddress;
    }

    public String getType() {
        return this.type;
    }

    public void setType(String type) {
        this.type = type;
    }

}
