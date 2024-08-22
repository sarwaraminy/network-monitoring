package cyber.wissen.dto;

public class LlcHeaderDTO {
    private String dsap;
    private String ssap;
    private String control;
    
    // Getters and setters

    public String getDsap() {
        return this.dsap;
    }

    public void setDsap(String dsap) {
        this.dsap = dsap;
    }

    public String getSsap() {
        return this.ssap;
    }

    public void setSsap(String ssap) {
        this.ssap = ssap;
    }

    public String getControl() {
        return this.control;
    }

    public void setControl(String control) {
        this.control = control;
    }

}
