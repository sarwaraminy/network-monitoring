import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAvailable, libraryVersion, listDevices, openLive } from './libpcap.js';

/**
 * Integration tests for the FFI binding. Everything here is skipped when no pcap
 * library is present, so the suite still passes on a machine without Npcap.
 *
 * Opening a live handle needs capture privileges (Administrator on Windows). When
 * that is the only thing missing, the open tests are skipped rather than failed.
 */

const available = isAvailable();
const skip = available ? false : 'no pcap library on this machine';

describe('libpcap binding', () => {
  it('reports a library version', { skip }, () => {
    const version = libraryVersion();
    assert.ok(version, 'expected a version string');
    assert.match(version, /libpcap|Npcap/i);
  });

  it('enumerates devices with names', { skip }, () => {
    const devices = listDevices();
    assert.ok(devices.length > 0, 'expected at least one capture device');
    for (const device of devices) {
      assert.equal(typeof device.name, 'string');
      assert.ok(device.name.length > 0);
      assert.ok(Array.isArray(device.addresses));
    }
  });

  it('can be called repeatedly without leaking the device list', { skip }, () => {
    // pcap_freealldevs runs in a finally block; a leak here would show up as a
    // crash or a steadily growing RSS across iterations.
    const counts = new Set<number>();
    for (let i = 0; i < 25; i += 1) counts.add(listDevices().length);
    assert.equal(counts.size, 1, 'device count should be stable across calls');
  });

  describe('live handle', () => {
    /** First device with an IPv4 address — loopback and WAN miniports can't be opened. */
    const target = available
      ? listDevices().find((device) => device.addresses.some((a) => a.includes('.') && !a.startsWith('127.')))
      : undefined;

    let handleSkip: false | string = skip;
    if (!handleSkip && !target) handleSkip = 'no device with an IPv4 address';
    if (!handleSkip) {
      // Probe once: if activation is refused, skip instead of failing the suite.
      try {
        openLive({
          device: target!.name,
          snapshotLength: 65_536,
          timeoutMs: 10,
          bufferSize: 1024 * 1024,
        }).close();
      } catch (error) {
        handleSkip = `cannot open a live handle: ${(error as Error).message}`;
      }
    }

    it('opens an Ethernet handle and drains without blocking', { skip: handleSkip }, () => {
      const handle = openLive({
        device: target!.name,
        snapshotLength: 65_536,
        timeoutMs: 10,
        bufferSize: 1024 * 1024,
      });

      try {
        assert.equal(handle.closed, false);
        assert.equal(typeof handle.linkType, 'string');

        // Non-blocking: this returns straight away whether or not traffic arrived.
        const started = Date.now();
        const frames = handle.drain(64);
        assert.ok(Date.now() - started < 1000, 'drain() must not block');

        for (const frame of frames) {
          assert.ok(Buffer.isBuffer(frame.data));
          assert.ok(frame.data.length > 0);
          // caplen never exceeds the wire length.
          assert.ok(frame.data.length <= frame.wireLength);
          assert.ok(frame.timestamp instanceof Date);
          assert.ok(Number.isFinite(frame.timestamp.getTime()), 'timestamp must be valid');
        }
      } finally {
        handle.close();
      }
    });

    it('accepts a valid BPF filter', { skip: handleSkip }, () => {
      const handle = openLive({
        device: target!.name,
        snapshotLength: 65_536,
        timeoutMs: 10,
        bufferSize: 1024 * 1024,
      });
      try {
        handle.setFilter('host 10.0.0.1');
        handle.setFilter('ip or arp');
      } finally {
        handle.close();
      }
    });

    it('rejects a malformed BPF filter', { skip: handleSkip }, () => {
      const handle = openLive({
        device: target!.name,
        snapshotLength: 65_536,
        timeoutMs: 10,
        bufferSize: 1024 * 1024,
      });
      try {
        assert.throws(() => handle.setFilter('this is not a filter'), /Invalid capture filter/);
      } finally {
        handle.close();
      }
    });

    it('is inert after close', { skip: handleSkip }, () => {
      const handle = openLive({
        device: target!.name,
        snapshotLength: 65_536,
        timeoutMs: 10,
        bufferSize: 1024 * 1024,
      });
      handle.close();

      assert.equal(handle.closed, true);
      assert.deepEqual(handle.drain(16), [], 'drain() on a closed handle returns nothing');
      handle.close(); // idempotent — must not double-free
      assert.throws(() => handle.setFilter('ip'), /closed/);
    });
  });

  it('rejects an unknown device', { skip }, () => {
    assert.throws(
      () =>
        openLive({
          device: 'nmt-no-such-device',
          snapshotLength: 65_536,
          timeoutMs: 10,
          bufferSize: 1024 * 1024,
        }),
      /nmt-no-such-device|No such|not|failed/i,
    );
  });
});
