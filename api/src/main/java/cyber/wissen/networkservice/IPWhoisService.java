package cyber.wissen.networkservice;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.Socket;

public class IPWhoisService {

    public String getWhoisData(String ipAddress) {
        StringBuilder result = new StringBuilder();

        try (Socket socket = new Socket("whois.iana.org", 43);
             PrintWriter out = new PrintWriter(new OutputStreamWriter(socket.getOutputStream()), true);
             BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()))) {
            
            out.println(ipAddress);
            String line;
            while ((line = in.readLine()) != null) {
                result.append(line).append("\n");
            }
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
        return result.toString();
    }
}



