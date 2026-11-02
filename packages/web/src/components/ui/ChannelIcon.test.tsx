import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelIcon } from './ChannelIcon';

describe('a channel\'s icon', () => {
  it('is the type icon when the channel has none', () => {
    const { container } = render(<ChannelIcon type="text" icon={null} muted />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('class')).toContain('opacity-60');
  });

  it('is the emoji it was given, in its own colours however quiet the row is', () => {
    const { container } = render(<ChannelIcon type="text" icon="🎮" muted className="shrink-0" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('🎮');
    expect(span?.getAttribute('class')).not.toContain('opacity-60');
  });

  it('is an icon of the set, quiet with the row', () => {
    const { container } = render(<ChannelIcon type="voice" icon="glyph:rocket" muted />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 256 256');
    expect(svg?.getAttribute('class')).toContain('opacity-60');
  });
});
