import { describe, it, expect } from 'vitest';
import { buildCallUndeliverableToast } from '../../utils/callUndeliverableToast.js';

describe('buildCallUndeliverableToast', () => {
  const fail = (overrides: Partial<{ reason: string; peerOrigin?: string; peerLabel?: string }> = {}) => ({
    reason: 'peer_transient_failure',
    peerLabel: 'nova',
    ...overrides,
  });

  it('start + terminal single failure: existing copy', () => {
    expect(buildCallUndeliverableToast([fail()], true, 'start')).toMatch(/Could not reach nova/);
  });

  it('start + non-terminal: "some participants" copy', () => {
    expect(buildCallUndeliverableToast([fail()], false, 'start')).toMatch(/Some participants could not be reached/);
  });

  it('accept + terminal: tear-down copy', () => {
    expect(buildCallUndeliverableToast([fail()], true, 'accept'))
      .toMatch(/Couldn't confirm your accept with nova/);
  });

  it('reject + non-terminal: info copy', () => {
    expect(buildCallUndeliverableToast([fail()], false, 'reject'))
      .toMatch(/Couldn't notify nova that you declined/);
  });

  it('end + non-terminal: info copy', () => {
    expect(buildCallUndeliverableToast([fail()], false, 'end'))
      .toMatch(/Couldn't notify nova that you hung up/);
  });

  it('legacy two-arg signature still works', () => {
    expect(buildCallUndeliverableToast([fail()], true)).toMatch(/Could not reach nova/);
  });

  it('builds warning copy for host_unreachable (peer_transient_failure)', () => {
    const msg = buildCallUndeliverableToast(
      [{ reason: 'peer_transient_failure', peerOrigin: 'https://tavvit.local', peerLabel: 'Tavvit' }],
      true,
      'host_unreachable',
    );
    expect(msg).toBe('Call ended — Tavvit became unreachable.');
  });

  it('builds warning copy for host_unreachable (peer_rejected)', () => {
    const msg = buildCallUndeliverableToast(
      [{ reason: 'peer_rejected', peerOrigin: 'https://tavvit.local', peerLabel: 'Tavvit' }],
      true,
      'host_unreachable',
    );
    expect(msg).toBe('Call ended — this instance is no longer peered with Tavvit.');
  });

  // A peer's instance_name may be NULL (federation.md), and then the server sends no
  // peerLabel. This branch builds its own label, so the no_recipient test below does not cover it.
  it('host_unreachable falls back to origin when peerLabel missing', () => {
    const transient = { reason: 'peer_transient_failure', peerOrigin: 'https://tavvit.local' };
    const rejected = { reason: 'peer_rejected', peerOrigin: 'https://tavvit.local' };
    expect(buildCallUndeliverableToast([transient], true, 'host_unreachable'))
      .toBe('Call ended — tavvit.local became unreachable.');
    expect(buildCallUndeliverableToast([rejected], true, 'host_unreachable'))
      .toBe('Call ended — this instance is no longer peered with tavvit.local.');
  });

  it('renders no_recipient single-failure terminal copy', () => {
    const fail = (peerLabel = 'Tavvit') => ({
      reason: 'no_recipient',
      peerOrigin: 'https://tavvit.local',
      peerLabel,
    });
    expect(buildCallUndeliverableToast([fail()], true, 'start'))
      .toBe("Tavvit couldn't ring anyone.");
  });

  it('no_recipient falls back to origin when peerLabel missing', () => {
    const fail = {
      reason: 'no_recipient',
      peerOrigin: 'https://tavvit.local',
    };
    expect(buildCallUndeliverableToast([fail], true, 'start'))
      .toMatch(/tavvit\.local couldn't ring anyone\./);
  });

  it('no_recipient in a multi-failure terminal falls back to multi-instance copy', () => {
    const failures = [
      { reason: 'no_recipient', peerOrigin: 'https://tavvit.local', peerLabel: 'Tavvit' },
      { reason: 'peer_transient_failure', peerOrigin: 'https://nova.local', peerLabel: 'Nova' },
    ];
    expect(buildCallUndeliverableToast(failures, true, 'start'))
      .toMatch(/Could not reach 2 instances: Tavvit, Nova/);
  });

  it('no_recipient non-terminal uses the existing "Some participants" line', () => {
    const failures = [
      { reason: 'no_recipient', peerOrigin: 'https://tavvit.local', peerLabel: 'Tavvit' },
    ];
    expect(buildCallUndeliverableToast(failures, false, 'start'))
      .toMatch(/Some participants could not be reached: Tavvit/);
  });
});
