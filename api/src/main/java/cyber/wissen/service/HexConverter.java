package cyber.wissen.service;

public class HexConverter {
    
    public byte[] hexStringToByteArray(String hexString) {
        // Remove all spaces from the hex string
        hexString = hexString.replaceAll("\\s+", "");
    
        if (hexString == null || hexString.length() % 2 != 0) {
            throw new IllegalArgumentException("Invalid hex string: " + hexString);
        }
    
        int len = hexString.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hexString.charAt(i), 16) << 4)
                    + Character.digit(hexString.charAt(i + 1), 16));
        }
        return data;
    }
    

    public String formatAsReadable(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < data.length; i++) {
            if (i % 16 == 0 && i != 0) {
                sb.append("\n");
            }
            sb.append(String.format("%02X ", data[i]));
        }
        return sb.toString();
    }
}
