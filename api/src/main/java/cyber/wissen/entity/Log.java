package cyber.wissen.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name="logs")
public class Log {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private LocalDateTime timestamp = LocalDateTime.now();
    private String sourceip;
    private String sourcemac;
    private String destinationip;
    private String destinationmac;
    private String protocol;
    private String ipversion;
    private String details;
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
    // Getters and Setters


    public Long getId() {
        return this.id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public LocalDateTime getTimestamp() {
        return this.timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public String getSourceip() {
        return this.sourceip;
    }

    public void setSourceip(String sourceip) {
        this.sourceip = sourceip;
    }

    public String getSourcemac() {
        return this.sourcemac;
    }

    public void setSourcemac(String sourcemac) {
        this.sourcemac = sourcemac;
    }

    public String getDestinationip() {
        return this.destinationip;
    }

    public void setDestinationip(String destinationip) {
        this.destinationip = destinationip;
    }

    public String getDestinationmac() {
        return this.destinationmac;
    }

    public void setDestinationmac(String destinationmac) {
        this.destinationmac = destinationmac;
    }

    public String getProtocol() {
        return this.protocol;
    }

    public void setProtocol(String protocol) {
        this.protocol = protocol;
    }

    public String getIpversion() {
        return this.ipversion;
    }

    public void setIpversion(String ipversion) {
        this.ipversion = ipversion;
    }

    public String getDetails() {
        return this.details;
    }

    public void setDetails(String details) {
        this.details = details;
    }

    public LocalDateTime getCreatedAt() {
        return this.createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

}
