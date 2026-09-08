/**
 * Wire shapes returned by the API. These replace the Java `cyber.wissen.dto`
 * package; field names are unchanged so existing clients keep working.
 */

/** Was NetworkInterfaceDTO. */
export interface NetworkInterfaceDTO {
  name: string;
  description: string | null;
  addresses: string[];
}

/** Was EthernetHeaderDTO. */
export interface EthernetHeaderDTO {
  destinationAddress: string;
  sourceAddress: string;
  type: string;
}

/** Was LlcHeaderDTO. */
export interface LlcHeaderDTO {
  dsap: string;
  ssap: string;
  control: string;
}

/** Was PacketDTO. */
export interface PacketDTO {
  ethernetHeader: EthernetHeaderDTO;
  llcHeader: LlcHeaderDTO | null;
  dataHexStream: string;
  ethernetPadHexStream: string;
  sourceIpAddress: string | null;
  destinationIpAddress: string | null;
  /** Bytes captured for this frame, still reported when the payload is redacted. */
  frameLength: number;
  /** True when REDACT_PACKET_PAYLOAD blanked the hex streams. */
  payloadRedacted: boolean;
}

/** Was LoginRequest. */
export interface LoginRequestBody {
  email: string;
  password: string;
}

/** Was LoginResponse, plus the token that used to be header-only. */
export interface LoginResponseBody {
  id: number;
  email: string | null;
  firstName: string;
  lastName: string | null;
  role: string;
  /**
   * The account's language.
   *
   * Carried here as well as on `GET /auth/me` so the interface switches language
   * on the sign-in itself rather than on the next reload. `/me` is only reached
   * when validating a stored token, so without this the first session after a
   * sign-in is the one session that ignores the preference.
   */
  langCode: string;
  token: string;
}

/** Was SignupRequest. */
export interface SignupRequestBody {
  username?: string;
  email: string;
  password: string;
  firstname: string;
  lastname?: string;
  role: string;
  langCode: string;
}

/** A user as exposed over HTTP — never includes the password hash. */
export interface PublicUser {
  id: number;
  email: string | null;
  role: string;
  langCode: string;
  firstname: string;
  lastname: string | null;
  createdAt: string;
}

/** Response of GET /api/packets/ip-info. */
export interface IpInfoResponse {
  ipAddress: string;
  domainName: string | null;
  whoisData: string | null;
  geoData: Record<string, unknown> | null;
}
