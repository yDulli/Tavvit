import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IDLE_BEFORE_INSTALL_SECONDS, consumeRestartHidden, markRestartHidden, shouldInstallNow } from './updateInstall';

describe('when a downloaded update installs', () => {
  it('never during a call', () => {
    expect(shouldInstallNow({ inCall: true, windowVisible: false, systemIdleSeconds: 99_999 })).toBe(false);
  });

  it('at once while the window is in the tray or minimised', () => {
    expect(shouldInstallNow({ inCall: false, windowVisible: false, systemIdleSeconds: 0 })).toBe(true);
  });

  it('with the window open, only after nobody used the computer for a while', () => {
    expect(shouldInstallNow({ inCall: false, windowVisible: true, systemIdleSeconds: IDLE_BEFORE_INSTALL_SECONDS - 1 })).toBe(false);
    expect(shouldInstallNow({ inCall: false, windowVisible: true, systemIdleSeconds: IDLE_BEFORE_INSTALL_SECONDS })).toBe(true);
  });
});

describe('starting hidden after an update', () => {
  it('is remembered once, only while recent, and only by a start under the new version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-update-'));
    expect(consumeRestartHidden(dir, '1.12.1')).toBe(false);
    markRestartHidden(dir, '1.12.0', 1_000);
    expect(consumeRestartHidden(dir, '1.12.1', 2_000)).toBe(true);
    expect(consumeRestartHidden(dir, '1.12.1', 2_000)).toBe(false);
    markRestartHidden(dir, '1.12.0', 1_000);
    expect(consumeRestartHidden(dir, '1.12.1', 1_000 + 11 * 60 * 1000)).toBe(false);
    // The install never happened: the same version starts, with its window.
    markRestartHidden(dir, '1.12.1', 1_000);
    expect(consumeRestartHidden(dir, '1.12.1', 2_000)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
