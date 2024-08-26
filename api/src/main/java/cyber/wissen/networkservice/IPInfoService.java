package cyber.wissen.networkservice;

import java.net.InetAddress;
import java.net.UnknownHostException;

import org.springframework.stereotype.Service;

@Service
public class IPInfoService {

    public String getDomainName(String ipAddress) {
        try {
            InetAddress inetAddress = InetAddress.getByName(ipAddress);
            return inetAddress.getCanonicalHostName();
        } catch (UnknownHostException e) {
            e.printStackTrace();
            return null; // or return ipAddress if domain name is not found
        }
    }
}

