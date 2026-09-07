/**
 * Sends synthetic NetFlow v5 to the collector, so the demo recording has
 * something to show.
 *
 * A tour of empty screens is worse than no tour: the alerts table is where this
 * tool earns its place, and a recording of it holding seven identical medium
 * findings tells a viewer the opposite of what the README claims. So this fills
 * the screens before `record-demo.mjs` photographs them.
 *
 * It does *not* insert alerts. The datagrams go in over UDP exactly as a switch
 * would send them, get parsed by the real parser and judged by the real
 * detectors, so what ends up on screen is the product working — thresholds,
 * evidence, aggregation and all. An INSERT into `alerts` would be quicker and
 * would be a picture of a database rather than of a detector, which is the kind
 * of demo that stops matching the product the first time a threshold changes.
 *
 *   FLOW_ENABLED=true INTEL_ENABLED=true INTEL_FEEDS=demo=scripts/demo/indicators.txt npm run dev
 *   tsx scripts/demo/traffic.mts
 *
 *   FLOW_HOST   collector address   (default 127.0.0.1)
 *   FLOW_PORT   collector port      (default 2055)
 *
 * Every address is from a documentation or private range — RFC 5737 outside,
 * RFC 1918 inside — so nothing here names a real host. The external ones are
 * the same five in `indicators.txt`, which is what makes the threat
 * intelligence screen light up.
 */

import { createSocket } from 'node:dgram';
import { buildNetflowV5, SYS_UPTIME_MS, type V5Flow } from '../../api/src/flow/test-datagrams.js';
import { TCP_FLAG } from '../../api/src/flow/types.js';

const HOST = process.env.FLOW_HOST ?? '127.0.0.1';
const PORT = Number(process.env.FLOW_PORT ?? 2055);

/** The format's own ceiling — the parser caps at this and counts the rest malformed. */
const RECORDS_PER_DATAGRAM = 30;

/**
 * Detector thresholds, from `env.detection` defaults. Deliberately restated
 * rather than imported: this script has to send *more* than the threshold, and
 * importing the live value would silently stop tripping the detector the day
 * someone raises the default — the run would still pass, and the recording
 * would quietly lose an alert.
 */
const PORT_SCAN_PORTS = 15;
const HOST_SWEEP_HOSTS = 20;
const SYN_FLOOD_ATTEMPTS = 300;

const COMPROMISED_HOST = '10.10.30.99';
const FILE_SERVER = '10.10.20.15';
const WORKSTATION = '10.10.30.41';

/** From `indicators.txt`, so these also match the loaded feed. */
const C2_SERVER = '192.0.2.66';
const HARVESTER = '192.0.2.101';
const PAYLOAD_STAGING = '198.51.100.24';
const BOTNET_CONTROLLER = '203.0.113.13';

/**
 * Stamps the datagram with the current export time.
 *
 * `buildNetflowV5` hardcodes a fixed export time, which is right for a parser
 * test asserting on known dates and wrong here: a flow's timestamp is derived
 * from it, so every alert would come out dated to that fixed day and the
 * dashboard's last-24-hours panels would be empty in the recording. Detection
 * windows key off arrival rather than flow time, so this changes only what the
 * alert says happened when, which is the one thing that has to say "now".
 *
 * Offset 8 is the header's `unix_secs`; the uptime at offset 4 is left alone, so
 * the builder's uptime-relative flow times still resolve a second or so back.
 */
function atCurrentTime(datagram: Buffer): Buffer {
  datagram.writeUInt32BE(Math.floor(Date.now() / 1000), 8);
  return datagram;
}

const socket = createSocket('udp4');

function send(flows: V5Flow[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const datagram = atCurrentTime(buildNetflowV5(flows));
    socket.send(datagram, PORT, HOST, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * In datagram-sized batches, paced.
 *
 * The collector reads one datagram at a time off the socket and its receive
 * buffer is finite; a thousand records pushed in a tight loop is how a UDP
 * listener drops most of them, and a dropped batch here reads as "the detector
 * missed it".
 */
async function sendAll(flows: V5Flow[]): Promise<void> {
  for (let index = 0; index < flows.length; index += RECORDS_PER_DATAGRAM) {
    await send(flows.slice(index, index + RECORDS_PER_DATAGRAM));
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** One source walking ports on one host. A few over the threshold, not a hundred. */
function portScan(): V5Flow[] {
  const ports = [
    21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 1433, 3306, 3389, 5432, 5900, 8080, 8443,
  ];
  return ports.map((dstPort, index) => ({
    srcIp: COMPROMISED_HOST,
    dstIp: FILE_SERVER,
    srcPort: 40_000 + index,
    dstPort,
    packets: 1,
    bytes: 60,
    tcpFlags: TCP_FLAG.SYN,
  }));
}

/** The same service across a subnet. 445, so it is not read as ordinary browsing. */
function hostSweep(): V5Flow[] {
  return Array.from({ length: HOST_SWEEP_HOSTS + 4 }, (_unused, index) => ({
    srcIp: COMPROMISED_HOST,
    dstIp: `10.10.50.${10 + index}`,
    srcPort: 45_000 + index,
    dstPort: 445,
    packets: 1,
    bytes: 60,
    tcpFlags: TCP_FLAG.SYN,
  }));
}

/** Half-open connections at a rate no client produces. */
function synFlood(): V5Flow[] {
  return Array.from({ length: SYN_FLOOD_ATTEMPTS + 40 }, (_unused, index) => ({
    srcIp: C2_SERVER,
    dstIp: FILE_SERVER,
    srcPort: 1024 + (index % 60_000),
    dstPort: 443,
    packets: 1,
    bytes: 60,
    tcpFlags: TCP_FLAG.SYN,
    firstUptimeMs: SYS_UPTIME_MS - 2_000,
    lastUptimeMs: SYS_UPTIME_MS - 1_900,
  }));
}

/**
 * Ordinary-looking conversations that happen to involve a listed address.
 *
 * Small and unremarkable on purpose — no threshold is crossed here. The point is
 * that threat intelligence is the one detector that does not need a threshold:
 * one packet to a known controller is the finding.
 */
function intelMatches(): V5Flow[] {
  return [
    {
      srcIp: WORKSTATION,
      dstIp: BOTNET_CONTROLLER,
      srcPort: 51_204,
      dstPort: 8443,
      packets: 42,
      bytes: 8_940,
    },
    { srcIp: WORKSTATION, dstIp: HARVESTER, srcPort: 51_310, dstPort: 443, packets: 18, bytes: 3_120 },
    {
      srcIp: COMPROMISED_HOST,
      dstIp: PAYLOAD_STAGING,
      srcPort: 49_820,
      dstPort: 80,
      packets: 96,
      bytes: 148_600,
    },
    { srcIp: COMPROMISED_HOST, dstIp: C2_SERVER, srcPort: 49_902, dstPort: 8080, packets: 12, bytes: 1_840 },
  ].map((flow) => ({ ...flow, tcpFlags: TCP_FLAG.SYN | TCP_FLAG.ACK }));
}

const STAGES: [string, () => V5Flow[]][] = [
  ['threat intelligence matches', intelMatches],
  ['port scan', portScan],
  ['host sweep', hostSweep],
  ['SYN flood', synFlood],
];

/**
 * Whether each stage still sends more than the detector it is aiming at needs.
 *
 * The port list is a realistic one rather than a generated range, so it does
 * not grow with the threshold it has to beat. Without this check, raising
 * DETECT_PORT_SCAN_PORTS past twenty would leave this script sending traffic
 * that is no longer a scan, every stage still reporting "sent", and the missing
 * alert only noticed while watching the finished recording.
 */
function shortOfThreshold(): string[] {
  const scanPorts = new Set(portScan().map((flow) => flow.dstPort)).size;
  const sweepHosts = new Set(hostSweep().map((flow) => flow.dstIp)).size;
  const floodAttempts = synFlood().length;

  const complaints: string[] = [];
  if (scanPorts <= PORT_SCAN_PORTS) {
    complaints.push(`port scan sends ${scanPorts} distinct ports, needs more than ${PORT_SCAN_PORTS}`);
  }
  if (sweepHosts <= HOST_SWEEP_HOSTS) {
    complaints.push(`host sweep sends ${sweepHosts} distinct hosts, needs more than ${HOST_SWEEP_HOSTS}`);
  }
  if (floodAttempts <= SYN_FLOOD_ATTEMPTS) {
    complaints.push(`SYN flood sends ${floodAttempts} attempts, needs more than ${SYN_FLOOD_ATTEMPTS}`);
  }
  return complaints;
}

const short = shortOfThreshold();
if (short.length > 0) {
  console.error('These stages would no longer trip their detector:');
  for (const complaint of short) console.error(`  ${complaint}`);
  console.error('\nRaise them here, or lower the threshold in the environment.');
  process.exit(1);
}

for (const [name, build] of STAGES) {
  const flows = build();
  await sendAll(flows);
  console.log(`sent ${flows.length} flows for ${name}`);
}

socket.close();

/*
 * The detectors judge on arrival, but the alert is written by a sink that
 * batches. Reporting "done" before that lands sends the recording off to
 * photograph a table that is still a second behind.
 */
await new Promise((done) => setTimeout(done, 2_000));
console.log('\nDone. Every stage was over the threshold it aims at.');
