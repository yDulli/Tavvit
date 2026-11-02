import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './Avatar';
import { useConnectedOriginsStore } from '../../stores/connectedOriginsStore';
import { useExternalMediaStore } from '../../stores/externalMediaStore';

const pictureOf = (container: HTMLElement) => container.querySelector('img');

beforeEach(() => {
  useConnectedOriginsStore.setState({ origins: [] });
  useExternalMediaStore.setState({ allowedHosts: [], alwaysAllow: false });
});

describe('an avatar', () => {
  it('shows a picture of this server at once', () => {
    const { container } = render(<Avatar src="/api/uploads/a.webp" name="Ada" />);
    expect(pictureOf(container)?.getAttribute('src')).toBe('/api/uploads/a.webp');
  });

  it('fetches nothing from a server this client does not talk to: the initials stand in', () => {
    const { container } = render(<Avatar src="https://tracker.example/p.png?u=victim" name="Ada" />);
    expect(pictureOf(container)).toBeNull();
    expect(container.textContent).toContain('A');
  });

  it('fetches from a server this client is signed into, or one the person allowed', () => {
    useConnectedOriginsStore.setState({ origins: ['https://other.example'] });
    const connected = render(<Avatar src="https://other.example/api/uploads/b.webp" name="Ada" />);
    expect(pictureOf(connected.container)).not.toBeNull();

    useExternalMediaStore.setState({ allowedHosts: ['allowed.example'] });
    const allowed = render(<Avatar src="https://allowed.example/c.png" name="Ada" />);
    expect(pictureOf(allowed.container)).not.toBeNull();
  });
});
