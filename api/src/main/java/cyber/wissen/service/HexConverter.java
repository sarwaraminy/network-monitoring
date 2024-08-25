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

        for (byte b : data) {
            if (b >= 32 && b <= 126) {
                // Printable ASCII range
                sb.append((char) b);
            } else {
                // Non-printable characters represented as hex
                sb.append(String.format("\\x%02X", b));
            }
        }

        return sb.toString();
    }
    
}
