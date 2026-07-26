import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { componentLogger } from '../logger.js';

const log = componentLogger('pcap');

/**
 * libpcap / Npcap binding via koffi FFI.
 *
 * This replaces Pcap4J. It calls the platform's existing pcap library directly
 * rather than going through a compiled Node addon, because koffi ships prebuilt
 * binaries — so `npm install` needs no C++ toolchain, which is what made the
 * `cap` package unusable here.
 *
 * Everything below is a thin, typed wrapper. Packet parsing lives in decode.ts.
 */

const require = createRequire(import.meta.url);

/** Directories searched when no well-known library name resolves. */
const UNIX_LIBRARY_DIRS = [
  '/usr/lib/x86_64-linux-gnu',
  '/usr/lib/aarch64-linux-gnu',
  '/usr/lib64',
  '/usr/lib',
  '/lib/x86_64-linux-gnu',
  '/lib',
  '/usr/local/lib',
  '/opt/homebrew/lib',
];

/**
 * Where the pcap shared library lives, most likely first.
 *
 * Distributions disagree about the soname symlinks they ship. Debian and Ubuntu's
 * runtime package (libpcap0.8) installs `libpcap.so.0.8` and *no* `libpcap.so.1`;
 * `libpcap.so` only appears with the -dev package. Listing several names and then
 * falling back to a directory scan covers the spread without requiring -dev.
 */
function libraryCandidates(): string[] {
  if (process.platform === 'win32') {
    // Npcap's own directory first; the System32 copy only exists in
    // "WinPcap API-compatible Mode".
    return ['C:/Windows/System32/Npcap/wpcap.dll', 'wpcap.dll'];
  }

  const names =
    process.platform === 'darwin'
      ? ['libpcap.dylib', 'libpcap.A.dylib', '/usr/lib/libpcap.dylib', '/usr/lib/libpcap.A.dylib']
      : ['libpcap.so.1', 'libpcap.so.0.8', 'libpcap.so'];

  return [...names, ...discoverUnixLibraries()];
}

/**
 * Scans the usual library directories for any `libpcap.so.*` / `libpcap*.dylib`,
 * newest-looking last so higher versions are preferred.
 */
function discoverUnixLibraries(): string[] {
  const pattern = process.platform === 'darwin' ? /^libpcap.*\.dylib$/ : /^libpcap\.so\.[\d.]+$/;
  const found: string[] = [];

  for (const dir of UNIX_LIBRARY_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // Directory absent on this system.
    }
    for (const entry of entries.filter((name) => pattern.test(name)).sort()) {
      found.push(join(dir, entry));
    }
  }

  // Later entries tend to be higher versions, so try those first.
  return found.reverse();
}

const AF_INET = 2;
const AF_INET6 = process.platform === 'win32' ? 23 : 10;

/** Return codes from pcap_next_ex. */
const NEXT_OK = 1;
const NEXT_TIMEOUT = 0;

/** DLT_* values mapped to the names the UI shows. */
const LINK_TYPE_NAMES = new Map<number, string>([
  [0, 'NULL'],
  [1, 'ETHERNET'],
  [6, 'IEEE802_5'],
  [8, 'SLIP'],
  [9, 'PPP'],
  [12, 'RAW'],
  [105, 'IEEE802_11'],
  [113, 'LINUX_SLL'],
  [127, 'IEEE802_11_RADIOTAP'],
  [143, 'DOCSIS'],
  [228, 'IPV4'],
  [229, 'IPV6'],
  [276, 'LINUX_SLL2'],
]);

export interface PcapDevice {
  name: string;
  description: string | null;
  addresses: string[];
}

export interface CapturedFrame {
  /** A copy of the frame; the library's own buffer is reused per packet. */
  data: Buffer;
  /** Bytes on the wire, which exceeds data.length when the snapshot truncated it. */
  wireLength: number;
  /** The capture timestamp reported by pcap, not the time we got around to reading it. */
  timestamp: Date;
}

export interface OpenLiveOptions {
  device: string;
  snapshotLength: number;
  /** pcap read timeout in milliseconds. */
  timeoutMs: number;
  bufferSize: number;
  promiscuous?: boolean;
}

export class PcapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PcapError';
  }
}

/** Thrown when the pcap library itself could not be loaded. */
export class PcapUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Could not load the packet capture library. ${
        process.platform === 'win32'
          ? 'Install Npcap from https://npcap.com/#download.'
          : 'Install libpcap (e.g. `sudo apt install libpcap0.8`).'
      } (${detail})`,
    );
    this.name = 'PcapUnavailableError';
  }
}

interface Bindings {
  version: string;
  libraryPath: string;
  findalldevs: (out: unknown[], errbuf: Buffer) => number;
  freealldevs: (devs: unknown) => void;
  create: (device: string, errbuf: Buffer) => unknown;
  setSnaplen: (handle: unknown, value: number) => number;
  setPromisc: (handle: unknown, value: number) => number;
  setTimeout: (handle: unknown, value: number) => number;
  setBufferSize: (handle: unknown, value: number) => number;
  activate: (handle: unknown) => number;
  setNonblock: (handle: unknown, value: number, errbuf: Buffer) => number;
  datalink: (handle: unknown) => number;
  compile: (handle: unknown, program: object, filter: string, optimize: number, netmask: number) => number;
  setfilter: (handle: unknown, program: object) => number;
  freecode: (program: object) => void;
  geterr: (handle: unknown) => string;
  close: (handle: unknown) => void;
  nextEx: (handle: unknown, header: unknown[], data: unknown[]) => number;
  decodeHeader: (pointer: unknown) => {
    ts: { tv_sec: number; tv_usec: number };
    caplen: number;
    len: number;
  };
  decodeDevice: (pointer: unknown) => {
    next: unknown;
    name: string;
    description: string | null;
    addresses: unknown;
    flags: number;
  };
  decodeAddress: (pointer: unknown) => { next: unknown; addr: unknown };
  decodeSockaddrFamily: (pointer: unknown) => number;
  decodeIpv4: (pointer: unknown) => number[];
  decodeIpv6: (pointer: unknown) => number[];
  readBytes: (pointer: unknown, length: number) => Buffer;
}

let bindings: Bindings | null = null;
let loadError: string | null = null;

function load(): Bindings {
  if (bindings) return bindings;
  if (loadError !== null) throw new PcapUnavailableError(loadError);

  try {
    // koffi builds its types at runtime, so there is nothing static to describe
    // the struct/function handles it returns. The `any` is contained to this
    // function; everything it produces is exposed through the typed `Bindings`.
    // biome-ignore lint/suspicious/noExplicitAny: untyped FFI surface, narrowed by Bindings
    const koffi: any = require('koffi');

    // biome-ignore lint/suspicious/noExplicitAny: holds a koffi library handle
    let lib: any = null;
    let libraryPath = '';
    const attempts: string[] = [];
    for (const candidate of libraryCandidates()) {
      try {
        lib = koffi.load(candidate);
        libraryPath = candidate;
        break;
      } catch (error) {
        attempts.push(`${candidate}: ${(error as Error).message}`);
      }
    }
    if (!lib) throw new Error(attempts.join('; '));

    // struct timeval — tv_sec/tv_usec are C longs, whose width koffi resolves per platform.
    const Timeval = koffi.struct('nmt_timeval', { tv_sec: 'long', tv_usec: 'long' });
    const PcapPkthdr = koffi.struct('nmt_pcap_pkthdr', { ts: Timeval, caplen: 'uint32', len: 'uint32' });
    const BpfProgram = koffi.struct('nmt_bpf_program', { bf_len: 'uint32', bf_insns: 'void *' });
    const PcapIf = koffi.struct('nmt_pcap_if', {
      next: 'void *',
      name: 'str',
      description: 'str',
      addresses: 'void *',
      flags: 'uint32',
    });
    const PcapAddr = koffi.struct('nmt_pcap_addr', {
      next: 'void *',
      addr: 'void *',
      netmask: 'void *',
      broadaddr: 'void *',
      dstaddr: 'void *',
    });
    const SockaddrIn = koffi.struct('nmt_sockaddr_in', {
      sin_family: 'uint16',
      sin_port: 'uint16',
      sin_addr: koffi.array('uint8', 4),
      sin_zero: koffi.array('uint8', 8),
    });
    const SockaddrIn6 = koffi.struct('nmt_sockaddr_in6', {
      sin6_family: 'uint16',
      sin6_port: 'uint16',
      sin6_flowinfo: 'uint32',
      sin6_addr: koffi.array('uint8', 16),
      sin6_scope_id: 'uint32',
    });

    const pointerToHeader = koffi.out(koffi.pointer(koffi.pointer(PcapPkthdr)));
    const pointerToData = koffi.out(koffi.pointer(koffi.pointer('uint8')));

    // Per-length array types are cached; frame sizes repeat heavily in practice.
    const arrayTypes = new Map<number, unknown>();
    const readBytes = (pointer: unknown, length: number): Buffer => {
      if (length <= 0) return Buffer.alloc(0);
      let type = arrayTypes.get(length);
      if (!type) {
        type = koffi.array('uint8', length, 'Typed');
        arrayTypes.set(length, type);
      }
      return Buffer.from(koffi.decode(pointer, type) as Uint8Array);
    };

    bindings = {
      version: lib.func('pcap_lib_version', 'str', [])(),
      libraryPath,
      findalldevs: lib.func('pcap_findalldevs', 'int', [koffi.out(koffi.pointer('void *')), 'char *']),
      freealldevs: lib.func('pcap_freealldevs', 'void', ['void *']),
      create: lib.func('pcap_create', 'void *', ['str', 'char *']),
      setSnaplen: lib.func('pcap_set_snaplen', 'int', ['void *', 'int']),
      setPromisc: lib.func('pcap_set_promisc', 'int', ['void *', 'int']),
      setTimeout: lib.func('pcap_set_timeout', 'int', ['void *', 'int']),
      setBufferSize: lib.func('pcap_set_buffer_size', 'int', ['void *', 'int']),
      activate: lib.func('pcap_activate', 'int', ['void *']),
      setNonblock: lib.func('pcap_setnonblock', 'int', ['void *', 'int', 'char *']),
      datalink: lib.func('pcap_datalink', 'int', ['void *']),
      compile: lib.func('pcap_compile', 'int', [
        'void *',
        koffi.out(koffi.pointer(BpfProgram)),
        'str',
        'int',
        'uint32',
      ]),
      setfilter: lib.func('pcap_setfilter', 'int', ['void *', koffi.pointer(BpfProgram)]),
      freecode: lib.func('pcap_freecode', 'void', [koffi.pointer(BpfProgram)]),
      geterr: lib.func('pcap_geterr', 'str', ['void *']),
      close: lib.func('pcap_close', 'void', ['void *']),
      nextEx: lib.func('pcap_next_ex', 'int', ['void *', pointerToHeader, pointerToData]),
      decodeHeader: (pointer) => koffi.decode(pointer, PcapPkthdr),
      decodeDevice: (pointer) => koffi.decode(pointer, PcapIf),
      decodeAddress: (pointer) => koffi.decode(pointer, PcapAddr),
      decodeSockaddrFamily: (pointer) => koffi.decode(pointer, SockaddrIn).sin_family,
      decodeIpv4: (pointer) => Array.from(koffi.decode(pointer, SockaddrIn).sin_addr as number[]),
      decodeIpv6: (pointer) => Array.from(koffi.decode(pointer, SockaddrIn6).sin6_addr as number[]),
      readBytes,
    };

    return bindings;
  } catch (error) {
    loadError = (error as Error).message;
    throw new PcapUnavailableError(loadError);
  }
}

export function isAvailable(): boolean {
  try {
    load();
    return true;
  } catch {
    return false;
  }
}

/** Version string of the loaded library, or null if it could not be loaded. */
export function libraryVersion(): string | null {
  try {
    const api = load();
    return `${api.version} [${api.libraryPath}]`;
  } catch {
    return null;
  }
}

function errorText(buffer: Buffer): string {
  const end = buffer.indexOf(0);
  return buffer.toString('utf8', 0, end === -1 ? buffer.length : end);
}

/** Was Pcaps.findAllDevs(). */
export function listDevices(): PcapDevice[] {
  const api = load();
  const out: unknown[] = [null];
  const errbuf = Buffer.alloc(256);

  if (api.findalldevs(out, errbuf) !== 0) {
    throw new PcapError(`pcap_findalldevs failed: ${errorText(errbuf)}`);
  }

  const head = out[0];
  const devices: PcapDevice[] = [];

  try {
    let node = head;
    // The list is short; the guard only protects against a corrupt chain.
    for (let index = 0; node && index < 256; index += 1) {
      const device = api.decodeDevice(node);
      devices.push({
        name: device.name,
        description: device.description ?? null,
        addresses: readAddresses(api, device.addresses),
      });
      node = device.next;
    }
  } finally {
    if (head) api.freealldevs(head);
  }

  return devices;
}

function readAddresses(api: Bindings, first: unknown): string[] {
  const addresses: string[] = [];
  let node = first;

  for (let index = 0; node && index < 32; index += 1) {
    const entry = api.decodeAddress(node);
    if (entry.addr) {
      const family = api.decodeSockaddrFamily(entry.addr);
      if (family === AF_INET) {
        addresses.push(api.decodeIpv4(entry.addr).join('.'));
      } else if (family === AF_INET6) {
        addresses.push(formatIpv6(api.decodeIpv6(entry.addr)));
      }
    }
    node = entry.next;
  }

  return addresses;
}

function formatIpv6(bytes: number[]): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  }
  // Good enough for a device label; decode.ts does full RFC 5952 for packet data.
  return groups.join(':').replace(/\b(?:0:){2,}/, ':');
}

class Handle {
  private handle: unknown;
  private isClosed = false;
  private readonly headerOut: unknown[] = [null];
  private readonly dataOut: unknown[] = [null];

  constructor(
    private readonly api: Bindings,
    handle: unknown,
    readonly linkType: string,
    readonly linkTypeValue: number,
  ) {
    this.handle = handle;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Applies a BPF filter expression, e.g. `host 10.0.0.5`. */
  setFilter(expression: string): void {
    this.assertOpen();
    const program = {} as { bf_len: number; bf_insns: unknown };
    // PCAP_NETMASK_UNKNOWN — only matters for `broadcast`/`multicast` primitives.
    if (this.api.compile(this.handle, program, expression, 1, 0xffffffff) !== 0) {
      throw new PcapError(`Invalid capture filter "${expression}": ${this.api.geterr(this.handle)}`);
    }
    try {
      if (this.api.setfilter(this.handle, program) !== 0) {
        throw new PcapError(`Could not apply capture filter: ${this.api.geterr(this.handle)}`);
      }
    } finally {
      this.api.freecode(program);
    }
  }

  /**
   * Reads whatever frames are already buffered, up to `maxFrames`, and returns
   * immediately. The handle is in non-blocking mode, so this never waits on the
   * network — the caller polls it.
   */
  drain(maxFrames: number): CapturedFrame[] {
    if (this.isClosed) return [];

    const frames: CapturedFrame[] = [];
    for (let i = 0; i < maxFrames; i += 1) {
      const result = this.api.nextEx(this.handle, this.headerOut, this.dataOut);

      if (result === NEXT_TIMEOUT) break; // nothing buffered right now
      if (result !== NEXT_OK) {
        // -1 is an error, -2 means the capture ended. Either way, stop reading.
        throw new PcapError(`pcap_next_ex failed (${result}): ${this.api.geterr(this.handle)}`);
      }

      const header = this.api.decodeHeader(this.headerOut[0]);
      frames.push({
        data: this.api.readBytes(this.dataOut[0], header.caplen),
        wireLength: header.len,
        timestamp: new Date(header.ts.tv_sec * 1000 + Math.floor(header.ts.tv_usec / 1000)),
      });
    }
    return frames;
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.api.close(this.handle);
    this.handle = null;
  }

  private assertOpen(): void {
    if (this.isClosed) throw new PcapError('The capture handle is closed');
  }
}

export type PcapHandle = Handle;

/**
 * Opens a live capture. Uses the pcap_create/activate flow rather than
 * pcap_open_live so the kernel buffer size and read timeout can be set.
 */
export function openLive(options: OpenLiveOptions): PcapHandle {
  const api = load();
  const errbuf = Buffer.alloc(256);

  const handle = api.create(options.device, errbuf);
  if (!handle) {
    throw new PcapError(`Could not open ${options.device}: ${errorText(errbuf)}`);
  }

  try {
    api.setSnaplen(handle, options.snapshotLength);
    api.setPromisc(handle, options.promiscuous === false ? 0 : 1);
    // Honoured properly here — the `cap` addon had no equivalent setting.
    api.setTimeout(handle, options.timeoutMs);
    api.setBufferSize(handle, options.bufferSize);

    const result = api.activate(handle);
    if (result < 0) {
      throw new PcapError(
        `Could not start capturing on ${options.device}: ${api.geterr(handle)}. ` +
          'The server may need to run with administrator privileges.',
      );
    }
    if (result > 0) {
      log.warn({ device: options.device, detail: api.geterr(handle) }, 'Capture activated with a warning');
    }

    // Non-blocking, so drain() can be polled from the event loop without stalling it.
    if (api.setNonblock(handle, 1, errbuf) !== 0) {
      throw new PcapError(`Could not switch ${options.device} to non-blocking mode: ${errorText(errbuf)}`);
    }

    const dlt = api.datalink(handle);
    return new Handle(api, handle, LINK_TYPE_NAMES.get(dlt) ?? `DLT_${dlt}`, dlt);
  } catch (error) {
    // Nothing was handed back to the caller, so this handle is ours to release.
    api.close(handle);
    throw error;
  }
}
