import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { IE, VARIABLE_LENGTH } from './fields.js';
import { TemplateCache } from './templates.js';
import {
  buildDataSet,
  buildIpfixMessage,
  buildNetflowV5,
  buildNetflowV9Message,
  buildRecord,
  buildSflowHeader,
  buildTemplateSet,
  EXPORT_TIME,
  type FieldSpec,
  ipv4,
  mac,
  ntpTimestamp,
  STANDARD_FIELDS,
  SYS_UPTIME_MS,
  standardValues,
  uint,
} from './test-datagrams.js';
import { isUnansweredTcp, TCP_FLAG } from './types.js';

/**
 * Flow collector tests.
 *
 * Same two obligations as the packet detector suite, and the second is the one
 * that earns its keep: ordinary traffic must stay silent. The rules these replace
 * flagged every new connection, which made 100% of the alerts in the real database
 * false positives. A flow-based detector has exactly the same failure mode
 * available to it — every TCP flow contains a SYN — so the "quiet on normal
 * traffic" cases below are the regression guard.
 */

let parse: typeof import('./parse.js');
let detect: typeof import('./detect.js');

before(async () => {
  process.env.JWT_SECRET ??= 'test-secret-not-used-for-signing';
  // Thresholds are read at construction, so pin them before importing.
  process.env.DETECT_PORT_SCAN_PORTS = '15';
  process.env.DETECT_HOST_SWEEP_HOSTS = '20';
  process.env.DETECT_SYN_FLOOD_ATTEMPTS = '300';
  process.env.DETECT_SCAN_WINDOW_MS = '60000';
  process.env.DETECT_FLOOD_WINDOW_MS = '10000';
  parse = await import('./parse.js');
  detect = await import('./detect.js');
});

const EXPORTER = '10.0.0.1';
const OBSERVED_AT = new Date('2026-07-26T12:00:05Z');

function parseOne(datagram: Buffer, templates = new TemplateCache()) {
  return parse.parseFlowDatagram(datagram, EXPORTER, OBSERVED_AT, templates);
}

describe('NetFlow v5 parsing', () => {
  it('decodes the fixed record layout', () => {
    const result = parseOne(
      buildNetflowV5([
        {
          srcIp: '10.0.0.66',
          dstIp: '10.0.0.89',
          srcPort: 51_234,
          dstPort: 445,
          packets: 2,
          bytes: 120,
          tcpFlags: TCP_FLAG.SYN,
        },
      ]),
    );

    assert.equal(result.version, 5);
    assert.equal(result.malformed, 0);
    assert.equal(result.records.length, 1);

    const flow = result.records[0]!;
    assert.equal(flow.srcIp, '10.0.0.66');
    assert.equal(flow.dstIp, '10.0.0.89');
    assert.equal(flow.srcPort, 51_234);
    assert.equal(flow.dstPort, 445);
    assert.equal(flow.protocol, 6);
    assert.equal(flow.protocolName, 'TCP');
    assert.equal(flow.packets, 2);
    assert.equal(flow.bytes, 120);
    assert.equal(flow.tcpFlags, TCP_FLAG.SYN);
    assert.equal(flow.exporter, EXPORTER);
    assert.equal(flow.protocolVersion, 'netflow5');
    // engine_id, not the source address.
    assert.equal(flow.observationDomain, 7);
    // v5 carries no MAC addresses; null rather than a zeroed placeholder.
    assert.equal(flow.srcMac, null);
    assert.equal(flow.dstMac, null);
  });

  it('converts switch uptime to absolute time', () => {
    // A flow that ended two seconds before export.
    const result = parseOne(
      buildNetflowV5([
        {
          srcIp: '10.0.0.5',
          dstIp: '10.0.0.6',
          srcPort: 1,
          dstPort: 2,
          firstUptimeMs: SYS_UPTIME_MS - 5000,
          lastUptimeMs: SYS_UPTIME_MS - 2000,
        },
      ]),
    );

    const flow = result.records[0]!;
    assert.equal(flow.end.getTime(), EXPORT_TIME - 2000);
    assert.equal(flow.start.getTime(), EXPORT_TIME - 5000);
  });

  it('decodes every record in a multi-record datagram', () => {
    const flows = Array.from({ length: 12 }, (_, index) => ({
      srcIp: '10.0.0.66',
      dstIp: '10.0.0.89',
      srcPort: 40_000 + index,
      dstPort: 1000 + index,
    }));

    const result = parseOne(buildNetflowV5(flows));
    assert.equal(result.records.length, 12);
    assert.deepEqual(
      result.records.map((flow) => flow.dstPort),
      flows.map((flow) => flow.dstPort),
    );
  });

  it('trusts the buffer over a header claiming more records than are present', () => {
    // A count of 30 with only one record's worth of bytes: reading on faith would
    // walk 1392 bytes past the end of the datagram.
    const datagram = buildNetflowV5([{ srcIp: '10.0.0.1', dstIp: '10.0.0.2', srcPort: 1, dstPort: 2 }], {
      count: 30,
    });

    const result = parseOne(datagram);
    assert.equal(result.records.length, 1);
    assert.equal(result.malformed, 1);
  });

  it('reports a truncated header as malformed instead of throwing', () => {
    const result = parseOne(Buffer.concat([uint(5, 2), uint(1, 2)]));
    assert.equal(result.records.length, 0);
    assert.equal(result.malformed, 1);
  });
});

describe('IPFIX parsing', () => {
  it('decodes a data set using a template from the same message', () => {
    const datagram = buildIpfixMessage([
      buildTemplateSet(256, STANDARD_FIELDS, 'ipfix'),
      buildDataSet(256, [
        buildRecord(
          STANDARD_FIELDS,
          standardValues({ srcIp: '192.168.1.10', dstIp: '192.168.1.20', srcPort: 4444, dstPort: 22 }),
        ),
      ]),
    ]);

    const result = parseOne(datagram);
    assert.equal(result.version, 10);
    assert.equal(result.malformed, 0);
    assert.equal(result.pendingTemplates, 0);
    assert.equal(result.records.length, 1);

    const flow = result.records[0]!;
    assert.equal(flow.srcIp, '192.168.1.10');
    assert.equal(flow.dstIp, '192.168.1.20');
    assert.equal(flow.dstPort, 22);
    assert.equal(flow.protocolVersion, 'ipfix');
    assert.equal(flow.observationDomain, 42);
  });

  it('decodes data that arrives in a later message than its template', () => {
    // The real sequence: templates are sent on their own interval, so the first
    // data messages after a collector restart reference a template it has not seen.
    const templates = new TemplateCache();

    const orphaned = parseOne(
      buildIpfixMessage([
        buildDataSet(256, [
          buildRecord(
            STANDARD_FIELDS,
            standardValues({ srcIp: '10.1.1.1', dstIp: '10.1.1.2', srcPort: 1, dstPort: 2 }),
          ),
        ]),
      ]),
      templates,
    );
    assert.equal(orphaned.records.length, 0);
    assert.equal(orphaned.pendingTemplates, 1, 'should be reported as pending, not malformed');
    assert.equal(orphaned.malformed, 0);

    parseOne(buildIpfixMessage([buildTemplateSet(256, STANDARD_FIELDS, 'ipfix')]), templates);

    const decoded = parseOne(
      buildIpfixMessage([
        buildDataSet(256, [
          buildRecord(
            STANDARD_FIELDS,
            standardValues({ srcIp: '10.1.1.1', dstIp: '10.1.1.2', srcPort: 1, dstPort: 2 }),
          ),
        ]),
      ]),
      templates,
    );
    assert.equal(decoded.records.length, 1);
    assert.equal(decoded.records[0]?.srcIp, '10.1.1.1');
  });

  it('decodes several records packed into one data set', () => {
    const records = Array.from({ length: 5 }, (_, index) =>
      buildRecord(
        STANDARD_FIELDS,
        standardValues({ srcIp: '10.2.0.1', dstIp: '10.2.0.2', srcPort: 30_000 + index, dstPort: 80 }),
      ),
    );

    const result = parseOne(
      buildIpfixMessage([buildTemplateSet(256, STANDARD_FIELDS, 'ipfix'), buildDataSet(256, records)]),
    );

    assert.equal(result.records.length, 5);
    assert.equal(result.malformed, 0, 'set padding must not be decoded as a record');
  });

  it('skips fields it does not recognise, using the template length', () => {
    // A vendor template with unknown elements either side of the ones we read.
    // This is the normal case on real hardware, not an edge case.
    const fields: FieldSpec[] = [
      { informationElement: 9999, length: 3 },
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: 8888, length: 8 },
      { informationElement: IE.DESTINATION_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.DESTINATION_TRANSPORT_PORT, length: 2 },
      { informationElement: 7777, length: 1 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('172.16.0.5')],
      [IE.DESTINATION_IPV4_ADDRESS, ipv4('172.16.0.9')],
      [IE.DESTINATION_TRANSPORT_PORT, uint(3389, 2)],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(300, fields, 'ipfix'),
        buildDataSet(300, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records.length, 1);
    const flow = result.records[0]!;
    assert.equal(flow.srcIp, '172.16.0.5');
    assert.equal(flow.dstIp, '172.16.0.9');
    assert.equal(flow.dstPort, 3389);
  });

  it('does not read an enterprise field as though it were an IANA element', () => {
    // Enterprise element 8 must not be mistaken for sourceIPv4Address.
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4, enterprise: 9 },
      { informationElement: IE.DESTINATION_IPV4_ADDRESS, length: 4 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('1.2.3.4')],
      [IE.DESTINATION_IPV4_ADDRESS, ipv4('5.6.7.8')],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(301, fields, 'ipfix'),
        buildDataSet(301, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.srcIp, null, 'enterprise-scoped field must be skipped');
    assert.equal(result.records[0]?.dstIp, '5.6.7.8');
  });

  it('reads MAC addresses when the template carries them', () => {
    const fields: FieldSpec[] = [
      ...STANDARD_FIELDS,
      { informationElement: IE.SOURCE_MAC_ADDRESS, length: 6 },
      { informationElement: IE.DESTINATION_MAC_ADDRESS, length: 6 },
    ];

    const values = standardValues({ srcIp: '10.3.0.1', dstIp: '10.3.0.2', srcPort: 1, dstPort: 2 });
    values.set(IE.SOURCE_MAC_ADDRESS, mac('12:34:56:78:9a:bc'));
    values.set(IE.DESTINATION_MAC_ADDRESS, mac('de:ad:be:ef:00:01'));

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(302, fields, 'ipfix'),
        buildDataSet(302, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records[0]?.srcMac, '12:34:56:78:9a:bc');
    assert.equal(result.records[0]?.dstMac, 'de:ad:be:ef:00:01');
  });

  it('handles reduced-size encoding of counters', () => {
    // RFC 7011 §6.2: a 4-byte counter may be sent in fewer bytes when it fits.
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.PACKET_DELTA_COUNT, length: 1 },
      { informationElement: IE.OCTET_DELTA_COUNT, length: 2 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('10.4.0.1')],
      [IE.PACKET_DELTA_COUNT, uint(7, 1)],
      [IE.OCTET_DELTA_COUNT, uint(4096, 2)],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(303, fields, 'ipfix'),
        buildDataSet(303, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records[0]?.packets, 7);
    assert.equal(result.records[0]?.bytes, 4096);
  });

  it('reads an 8-byte counter', () => {
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.OCTET_DELTA_COUNT, length: 8 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('10.4.0.2')],
      [IE.OCTET_DELTA_COUNT, uint(5_000_000_000, 8)],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(304, fields, 'ipfix'),
        buildDataSet(304, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records[0]?.bytes, 5_000_000_000);
  });

  it('decodes an NTP-format microsecond timestamp rather than reading it as an integer', () => {
    // Read as a plain integer this lands somewhere around the year 5 million, so
    // the flow would fall outside every dashboard period and detection window.
    const flowEnd = Date.parse('2026-07-26T11:59:58.500Z');
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.FLOW_END_MICROSECONDS, length: 8 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('10.5.0.1')],
      [IE.FLOW_END_MICROSECONDS, ntpTimestamp(flowEnd)],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(305, fields, 'ipfix'),
        buildDataSet(305, [buildRecord(fields, values)]),
      ]),
    );

    const end = result.records[0]!.end.getTime();
    assert.ok(Math.abs(end - flowEnd) <= 1, `expected ~${flowEnd}, got ${end}`);
  });

  it('falls back to arrival time when the exporter clock is nonsense', () => {
    // flowEndSeconds of 0 would date the flow to 1970, which silently excludes it
    // from every window. Arrival time is imprecise but usable.
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.FLOW_END_SECONDS, length: 4 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('10.5.0.2')],
      [IE.FLOW_END_SECONDS, uint(0, 4)],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(306, fields, 'ipfix'),
        buildDataSet(306, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records[0]?.end.getTime(), OBSERVED_AT.getTime());
  });

  it('decodes a variable-length field', () => {
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: 4444, length: VARIABLE_LENGTH },
      { informationElement: IE.DESTINATION_TRANSPORT_PORT, length: 2 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('10.6.0.1')],
      [4444, Buffer.from('some-vendor-string')],
      [IE.DESTINATION_TRANSPORT_PORT, uint(8443, 2)],
    ]);

    const result = parseOne(
      buildIpfixMessage([
        buildTemplateSet(307, fields, 'ipfix'),
        buildDataSet(307, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records.length, 1);
    // The port after the variable field proves the length prefix was consumed.
    assert.equal(result.records[0]?.dstPort, 8443);
  });

  it('stops at a set claiming to extend past the datagram', () => {
    const datagram = buildIpfixMessage([buildTemplateSet(256, STANDARD_FIELDS, 'ipfix')]);
    // Overwrite the set length with something impossible.
    datagram.writeUInt16BE(60_000, 18);

    const result = parseOne(datagram);
    assert.equal(result.records.length, 0);
    assert.equal(result.malformed, 1);
  });

  it('replaces a redefined template rather than keeping the old layout', () => {
    // Exporters reuse template IDs after a config change; RFC 7011 §8 says the
    // newest definition wins. Keeping the old one decodes plausible nonsense.
    const templates = new TemplateCache();
    parseOne(buildIpfixMessage([buildTemplateSet(256, STANDARD_FIELDS, 'ipfix')]), templates);

    const narrowed: FieldSpec[] = [
      { informationElement: IE.DESTINATION_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.DESTINATION_TRANSPORT_PORT, length: 2 },
    ];
    parseOne(buildIpfixMessage([buildTemplateSet(256, narrowed, 'ipfix')]), templates);

    const values = new Map([
      [IE.DESTINATION_IPV4_ADDRESS, ipv4('10.7.0.9')],
      [IE.DESTINATION_TRANSPORT_PORT, uint(1521, 2)],
    ]);
    const result = parseOne(
      buildIpfixMessage([buildDataSet(256, [buildRecord(narrowed, values)])]),
      templates,
    );

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.dstIp, '10.7.0.9');
    assert.equal(result.records[0]?.dstPort, 1521);
  });
});

describe('NetFlow v9 parsing', () => {
  it('decodes a data set using template set id 0', () => {
    const datagram = buildNetflowV9Message([
      buildTemplateSet(256, STANDARD_FIELDS, 'v9'),
      buildDataSet(256, [
        buildRecord(
          STANDARD_FIELDS,
          standardValues({ srcIp: '10.8.0.1', dstIp: '10.8.0.2', srcPort: 5, dstPort: 23 }),
        ),
      ]),
    ]);

    const result = parseOne(datagram);
    assert.equal(result.version, 9);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.protocolVersion, 'netflow9');
    assert.equal(result.records[0]?.dstPort, 23);
    assert.equal(result.records[0]?.observationDomain, 9);
  });

  it('resolves uptime-relative flow times against the header', () => {
    const fields: FieldSpec[] = [
      { informationElement: IE.SOURCE_IPV4_ADDRESS, length: 4 },
      { informationElement: IE.FLOW_START_SYS_UP_TIME, length: 4 },
      { informationElement: IE.FLOW_END_SYS_UP_TIME, length: 4 },
    ];

    const values = new Map([
      [IE.SOURCE_IPV4_ADDRESS, ipv4('10.8.0.3')],
      [IE.FLOW_START_SYS_UP_TIME, uint(SYS_UPTIME_MS - 4000, 4)],
      [IE.FLOW_END_SYS_UP_TIME, uint(SYS_UPTIME_MS - 1000, 4)],
    ]);

    const result = parseOne(
      buildNetflowV9Message([
        buildTemplateSet(320, fields, 'v9'),
        buildDataSet(320, [buildRecord(fields, values)]),
      ]),
    );

    const flow = result.records[0]!;
    assert.equal(flow.start.getTime(), EXPORT_TIME - 4000);
    assert.equal(flow.end.getTime(), EXPORT_TIME - 1000);
  });

  it('does not treat the top bit of a v9 field id as an enterprise marker', () => {
    // v9 has no enterprise bit, so element 0x8008 is element 32776, not
    // sourceIPv4Address with an enterprise number following it.
    const fields: FieldSpec[] = [
      { informationElement: 0x8008, length: 4 },
      { informationElement: IE.DESTINATION_IPV4_ADDRESS, length: 4 },
    ];

    const values = new Map([
      [0x8008, ipv4('9.9.9.9')],
      [IE.DESTINATION_IPV4_ADDRESS, ipv4('10.9.0.1')],
    ]);

    const result = parseOne(
      buildNetflowV9Message([
        buildTemplateSet(321, fields, 'v9'),
        buildDataSet(321, [buildRecord(fields, values)]),
      ]),
    );

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.dstIp, '10.9.0.1', 'field alignment must not shift');
  });
});

describe('version dispatch', () => {
  it('names a recognised but unimplemented version instead of calling it corrupt', () => {
    const result = parseOne(Buffer.concat([uint(8, 2), Buffer.alloc(22)]));
    assert.equal(result.unsupported, 'NetFlow v8 (aggregated)');
    assert.equal(result.malformed, 0);
  });

  it('counts an unknown version as malformed', () => {
    const result = parseOne(Buffer.concat([uint(1234, 2), Buffer.alloc(22)]));
    assert.equal(result.unsupported, null);
    assert.equal(result.malformed, 1);
  });

  it('tells sFlow apart from NetFlow v5, which shares its version number', () => {
    assert.equal(parse.looksLikeSflow(buildSflowHeader()), true);
    assert.equal(
      parse.looksLikeSflow(buildNetflowV5([{ srcIp: '1.1.1.1', dstIp: '2.2.2.2', srcPort: 1, dstPort: 2 }])),
      false,
    );
  });
});

describe('unanswered-connection test', () => {
  const base = {
    exporter: EXPORTER,
    observationDomain: 1,
    protocolVersion: 'ipfix' as const,
    protocol: 6,
    protocolName: 'TCP',
    srcIp: '10.0.0.66',
    dstIp: '10.0.0.89',
    srcPort: 40_000,
    dstPort: 445,
    packets: 1,
    bytes: 60,
    tcpFlags: TCP_FLAG.SYN,
    srcMac: null,
    dstMac: null,
    ingressInterface: null,
    egressInterface: null,
    start: OBSERVED_AT,
    end: OBSERVED_AT,
    observedAt: OBSERVED_AT,
  };

  it('accepts a SYN that was never acknowledged', () => {
    assert.equal(isUnansweredTcp({ ...base, tcpFlags: TCP_FLAG.SYN }), true);
  });

  it('rejects an established conversation', () => {
    // The distinction the packet-level rule could not make. Flags accumulate over
    // a flow, so a normal connection carries SYN *and* ACK.
    const established = TCP_FLAG.SYN | TCP_FLAG.ACK | TCP_FLAG.PSH | TCP_FLAG.FIN;
    assert.equal(isUnansweredTcp({ ...base, tcpFlags: established, packets: 40, bytes: 8000 }), false);
  });

  it('rejects a flow that carried real traffic when flags are missing', () => {
    assert.equal(isUnansweredTcp({ ...base, tcpFlags: null, packets: 30, bytes: 12_000 }), false);
  });

  it('accepts a small unanswered flow when the exporter omits flags', () => {
    assert.equal(isUnansweredTcp({ ...base, tcpFlags: null, packets: 1, bytes: 60 }), true);
  });

  it('ignores UDP, which has no handshake to be unanswered', () => {
    assert.equal(isUnansweredTcp({ ...base, protocol: 17, tcpFlags: null }), false);
  });
});

/** Builds an IPFIX datagram carrying one flow, for the detector tests. */
function flowDatagram(flow: {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol?: number;
  tcpFlags?: number;
  packets?: number;
  bytes?: number;
}): Buffer {
  return buildIpfixMessage([
    buildTemplateSet(256, STANDARD_FIELDS, 'ipfix'),
    buildDataSet(256, [buildRecord(STANDARD_FIELDS, standardValues(flow))]),
  ]);
}

/**
 * Runs flows through a fresh engine and returns everything it reported.
 *
 * `stepMs` is the gap between arrivals, and it matters: the flood window is 10
 * seconds, so 300 flows only trip the threshold if they are packed tightly enough
 * to land in one window. Spread them over 32 seconds and the window rolls over
 * mid-run, which is correct behaviour and a silently passing test.
 */
function runFlows(
  flows: Parameters<typeof flowDatagram>[0][],
  options: { startedAt?: number; stepMs?: number } = {},
) {
  const startedAt = options.startedAt ?? Date.parse('2026-07-26T12:00:00Z');
  const stepMs = options.stepMs ?? 100;
  const engine = new detect.FlowDetectionEngine();
  const templates = new TemplateCache();
  const findings = [];

  for (const [index, flow] of flows.entries()) {
    const observedAt = new Date(startedAt + index * stepMs);
    const result = parse.parseFlowDatagram(flowDatagram(flow), EXPORTER, observedAt, templates);
    for (const record of result.records) findings.push(...engine.inspect(record));
  }

  return findings;
}

describe('flow detection', () => {
  it('reports a port scan across many ports on one host', () => {
    const findings = runFlows(
      Array.from({ length: 20 }, (_, index) => ({
        srcIp: '10.0.0.66',
        dstIp: '10.0.0.89',
        srcPort: 40_000 + index,
        dstPort: 1000 + index,
        tcpFlags: TCP_FLAG.SYN,
      })),
    );

    const scan = findings.find((finding) => finding.kind === 'port_scan');
    assert.ok(scan, 'expected a port_scan finding');
    assert.equal(scan.sourceIp, '10.0.0.66');
    assert.equal(scan.targetIp, '10.0.0.89');
    assert.ok((scan.evidence.distinctPortsProbed as number) >= 15);
    // Provenance: with flow data, "how do you know" is a specific device.
    assert.equal(scan.evidence.exporter, EXPORTER);
    assert.equal(scan.evidence.observedVia, 'ipfix');
  });

  it('reports a host sweep across many hosts on one port', () => {
    const findings = runFlows(
      Array.from({ length: 25 }, (_, index) => ({
        srcIp: '10.0.0.66',
        dstIp: `10.0.1.${index + 1}`,
        srcPort: 40_000 + index,
        dstPort: 445,
        tcpFlags: TCP_FLAG.SYN,
      })),
    );

    const sweep = findings.find((finding) => finding.kind === 'host_sweep');
    assert.ok(sweep, 'expected a host_sweep finding');
    assert.equal(sweep.evidence.port, 445);
    assert.equal(sweep.evidence.service, 'SMBfilesharing');
  });

  it('reports a connection flood', () => {
    const findings = runFlows(
      Array.from({ length: 320 }, (_, index) => ({
        srcIp: '10.0.0.66',
        dstIp: '10.0.2.5',
        srcPort: 30_000 + index,
        dstPort: 80,
        tcpFlags: TCP_FLAG.SYN,
      })),
      // 10ms apart, so all 320 land inside the 10-second flood window.
      { stepMs: 10 },
    ).filter((finding) => finding.kind === 'syn_flood');

    assert.ok(findings.length > 0, 'expected a syn_flood finding');
    assert.ok((findings[0]!.evidence.attemptsInWindow as number) >= 300);
  });

  it('records the flow timestamp on the finding, not the arrival time', () => {
    const findings = runFlows(
      Array.from({ length: 20 }, (_, index) => ({
        srcIp: '10.0.0.70',
        dstIp: '10.0.0.80',
        srcPort: 40_000 + index,
        dstPort: 2000 + index,
        tcpFlags: TCP_FLAG.SYN,
      })),
    );

    const scan = findings.find((finding) => finding.kind === 'port_scan');
    assert.ok(scan);
    assert.ok(scan.timestamp instanceof Date);
    assert.ok(Number.isFinite(scan.timestamp.getTime()));
  });

  describe('stays quiet on ordinary traffic', () => {
    it('says nothing about a browser opening many established connections', () => {
      // The exact traffic that made every alert in the real database a false
      // positive: one machine opening hundreds of normal connections.
      const findings = runFlows(
        Array.from({ length: 200 }, (_, index) => ({
          srcIp: '10.0.0.89',
          dstIp: `104.16.${index % 8}.${index % 200}`,
          srcPort: 50_000 + index,
          dstPort: index % 2 === 0 ? 443 : 80,
          tcpFlags: TCP_FLAG.SYN | TCP_FLAG.ACK | TCP_FLAG.PSH | TCP_FLAG.FIN,
          packets: 25,
          bytes: 18_000,
        })),
      );

      assert.deepEqual(findings, [], 'established connections must not be reported');
    });

    it('says nothing about one host contacting many hosts on 443', () => {
      // Unanswered *and* on a client port. A CDN or a mail client legitimately
      // produces this, so the port exclusion has to hold even for unanswered flows.
      const findings = runFlows(
        Array.from({ length: 60 }, (_, index) => ({
          srcIp: '10.0.0.89',
          dstIp: `52.96.${index}.1`,
          srcPort: 50_000 + index,
          dstPort: 443,
          tcpFlags: TCP_FLAG.SYN,
        })),
      );

      assert.equal(
        findings.filter((finding) => finding.kind === 'host_sweep').length,
        0,
        'sweeps on client ports must be excluded',
      );
    });

    it('says nothing about a busy DNS resolver', () => {
      const findings = runFlows(
        Array.from({ length: 100 }, (_, index) => ({
          srcIp: '10.0.0.89',
          dstIp: '10.0.0.1',
          srcPort: 40_000 + index,
          dstPort: 53,
          protocol: 17,
          tcpFlags: 0,
          packets: 2,
          bytes: 200,
        })),
      );

      assert.deepEqual(findings, [], 'UDP has no handshake and must not trip scan rules');
    });

    it('says nothing about a file server transferring data to many clients', () => {
      const findings = runFlows(
        Array.from({ length: 50 }, (_, index) => ({
          srcIp: '10.0.0.10',
          dstIp: `10.0.3.${index + 1}`,
          srcPort: 445,
          dstPort: 50_000 + index,
          tcpFlags: TCP_FLAG.SYN | TCP_FLAG.ACK | TCP_FLAG.PSH,
          packets: 400,
          bytes: 500_000,
        })),
      );

      assert.deepEqual(findings, []);
    });
  });

  it('counts what it inspected, so an idle collector is distinguishable from a broken one', () => {
    const engine = new detect.FlowDetectionEngine();
    const templates = new TemplateCache();
    const result = parse.parseFlowDatagram(
      flowDatagram({ srcIp: '10.0.0.66', dstIp: '10.0.0.89', srcPort: 1, dstPort: 445 }),
      EXPORTER,
      OBSERVED_AT,
      templates,
    );
    for (const record of result.records) engine.inspect(record);

    const stats = engine.stats();
    assert.equal(stats.flowsInspected, 1);
    assert.equal(stats.unansweredFlows, 1);
  });
});

describe('template cache', () => {
  it('evicts rather than growing without bound on remote input', () => {
    const cache = new TemplateCache(3);
    for (let id = 256; id < 262; id += 1) {
      cache.set(
        { exporter: EXPORTER, observationDomain: 1, templateId: id },
        { id, fields: [], fixedLength: 0 },
      );
    }

    assert.equal(cache.size, 3);
    assert.equal(cache.evictionCount, 3);
    // The oldest went first.
    assert.equal(cache.get({ exporter: EXPORTER, observationDomain: 1, templateId: 256 }), undefined);
    assert.ok(cache.get({ exporter: EXPORTER, observationDomain: 1, templateId: 261 }));
  });

  it('keys templates by exporter and domain, not by id alone', () => {
    // Two switches both using template 256 for different layouts is normal.
    const cache = new TemplateCache();
    cache.set(
      { exporter: '10.0.0.1', observationDomain: 1, templateId: 256 },
      { id: 256, fields: [], fixedLength: 0 },
    );

    assert.equal(cache.get({ exporter: '10.0.0.2', observationDomain: 1, templateId: 256 }), undefined);
    assert.equal(cache.get({ exporter: '10.0.0.1', observationDomain: 2, templateId: 256 }), undefined);
    assert.ok(cache.get({ exporter: '10.0.0.1', observationDomain: 1, templateId: 256 }));
  });

  it('forgets one exporter without touching the others', () => {
    const cache = new TemplateCache();
    cache.set(
      { exporter: '10.0.0.1', observationDomain: 1, templateId: 256 },
      { id: 256, fields: [], fixedLength: 0 },
    );
    cache.set(
      { exporter: '10.0.0.2', observationDomain: 1, templateId: 256 },
      { id: 256, fields: [], fixedLength: 0 },
    );

    assert.equal(cache.forgetExporter('10.0.0.1'), 1);
    assert.equal(cache.get({ exporter: '10.0.0.1', observationDomain: 1, templateId: 256 }), undefined);
    assert.ok(cache.get({ exporter: '10.0.0.2', observationDomain: 1, templateId: 256 }));
  });
});
