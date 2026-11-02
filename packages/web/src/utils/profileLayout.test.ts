import { describe, expect, it } from 'vitest';
import { PROFILE_LAYOUTS } from '@backspace/shared';
import { profileHeaderLook, profileLayoutOf } from './profileLayout';

describe('profileLayoutOf', () => {
  it('reads a known layout and takes anything else as the standard one', () => {
    expect(profileLayoutOf({ profileLayout: 'compact' })).toBe('compact');
    expect(profileLayoutOf({ profileLayout: 'grid' })).toBe('standard');
    expect(profileLayoutOf({ profileLayout: null })).toBe('standard');
    expect(profileLayoutOf({})).toBe('standard');
  });
});

describe('profileHeaderLook', () => {
  it('gives the compact layout no banner on every surface, and the others one', () => {
    for (const surface of ['card', 'full', 'preview'] as const) {
      for (const layout of PROFILE_LAYOUTS) {
        const look = profileHeaderLook(layout, surface);
        if (layout === 'compact') expect(look.banner).toBeNull();
        else expect(look.banner).toMatch(/^h-\[\d+px\]$/);
        expect(look.avatarSize).toBeGreaterThan(0);
      }
    }
  });

  it('centres only the centered layout', () => {
    expect(profileHeaderLook('centered', 'card').header).toContain('items-center');
    expect(profileHeaderLook('standard', 'card').header).not.toContain('items-center');
  });
});
