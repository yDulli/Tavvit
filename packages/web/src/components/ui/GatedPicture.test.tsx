import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// AvatarStack reaches spaceStore, which imports AudioManager; jsdom has no AudioWorkletNode.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { ProfileBanner } from './ProfileBanner';
import { GatedPicture } from './ExternalMedia';
import { AvatarStack } from './AvatarStack';
import { useExternalMediaStore } from '../../stores/externalMediaStore';
import { useConnectedOriginsStore } from '../../stores/connectedOriginsStore';
import { cssUrl } from '../../utils/cssUrl';

// A picture a server names is fetched only from a server this client talks to, or once the person
// said yes to its host (docs/systems/legal.md): a banner, a group's icon and a space's icon too.

const ELSEWHERE = 'https://elsewhere.example/api/uploads/banner.png';
const CONNECTED = 'https://friends.example/api/uploads/banner.png';

beforeEach(() => {
  useExternalMediaStore.setState({ alwaysAllow: false, allowedHosts: [] });
  useConnectedOriginsStore.setState({ origins: ['https://friends.example'] });
});

afterEach(() => {
  cleanup();
  useConnectedOriginsStore.setState({ origins: [] });
});

describe('a profile banner', () => {
  it('on a server this client does not talk to shows the profile colours until the person says yes', () => {
    const { container } = render(<ProfileBanner className="h-20" src={ELSEWHERE} fallback="rgb(1, 2, 3)" />);
    const banner = container.firstElementChild as HTMLElement;
    expect(banner.style.backgroundImage).not.toContain('elsewhere.example');
    expect(banner.style.background).toContain('rgb(1, 2, 3)');
    act(() => { useExternalMediaStore.getState().allowHost('elsewhere.example'); });
    expect(banner.style.backgroundImage).toContain('elsewhere.example');
  });

  it('on a server this client talks to is shown at once', () => {
    const { container } = render(<ProfileBanner className="h-20" src={CONNECTED} fallback="rgb(1, 2, 3)" />);
    expect((container.firstElementChild as HTMLElement).style.backgroundImage).toContain('friends.example');
  });
});

describe('a space\'s or a group\'s icon', () => {
  it('stands aside for its fallback while it waits for a yes', () => {
    const { container } = render(<GatedPicture src={ELSEWHERE} alt="" whileBlocked={<span data-testid="letter">S</span>} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('S');
  });

  it('of a group on another server is not fetched: the members stand in', () => {
    const { container } = render(<AvatarStack members={[]} origin="" size={32} border="channel" iconUrl={ELSEWHERE} />);
    expect([...container.querySelectorAll('img')].some((img) => img.getAttribute('src') === ELSEWHERE)).toBe(false);
  });
});

describe('an address in a CSS url()', () => {
  it('cannot close it and open a second one', () => {
    // Inside the quotes a bracket closes nothing; only a quote or a line break could end the string,
    // and a backslash could undo the closing quote: all three are written as escapes.
    for (const address of ['https://friends.example/x.png"), url("https://tracker.example/p.png', 'https://friends.example/x.png\\', 'https://friends.example/a\nb']) {
      const value = cssUrl(address);
      expect(value.startsWith('url("')).toBe(true);
      expect(value.endsWith('")')).toBe(true);
      const inner = value.slice(5, -2);
      expect(inner).not.toMatch(/["\n\r\f]/);
      expect(inner.replace(/\\[0-9a-f]+ /g, '')).not.toContain('\\');
    }
  });
});
