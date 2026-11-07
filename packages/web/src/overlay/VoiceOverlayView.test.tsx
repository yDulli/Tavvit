import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { VoiceOverlayPerson } from '@backspace/shared/src/voiceOverlay';
import { VoiceOverlayView } from './VoiceOverlayView';

// What a voice overlay shows over a stream (docs/systems/voice-overlay.md).

afterEach(cleanup);

const person = (id: string, name: string, over: Partial<VoiceOverlayPerson> = {}): VoiceOverlayPerson => ({
  id, name, avatar: null, avatarColor: null, tileKey: id, frame: null, muted: false, deafened: false, ...over,
});
const PEOPLE = [person('a', 'Mara'), person('b', 'Robin', { muted: true }), person('c', 'Kim', { deafened: true })];

describe('VoiceOverlayView', () => {
  it('shows everyone with their names, and who speaks', () => {
    const { container } = render(<VoiceOverlayView people={PEOPLE} speaking={new Set(['a'])} options={{ layout: 'list', show: 'everyone', names: true }} />);
    expect(screen.getByText('Mara')).toBeTruthy();
    expect(screen.getByText('Robin')).toBeTruthy();
    const speaking = [...container.querySelectorAll('[data-speaking="true"]')];
    expect(speaking).toHaveLength(1);
    expect(speaking[0]!.textContent).toContain('Mara');
    // Muted and deafened carry a mark; the one who speaks does not.
    expect(container.querySelectorAll('.voice-overlay-mark')).toHaveLength(2);
  });

  it('shows only who speaks when asked, and pictures alone without names', () => {
    const { container } = render(<VoiceOverlayView people={PEOPLE} speaking={new Set(['b'])} options={{ layout: 'row', show: 'speaking', names: false }} />);
    expect(container.querySelectorAll('.voice-overlay-person')).toHaveLength(1);
    expect(screen.queryByText('Robin')).toBeNull();
    expect(container.querySelector('.voice-overlay')).toHaveAttribute('data-layout', 'row');
  });

  it('draws a picture where there is one, and the initial on the tile where there is none', () => {
    const { container } = render(<VoiceOverlayView people={[person('a', 'Mara', { avatar: 'mara.webp' }), person('b', 'robin')]} speaking={new Set()} options={{ layout: 'list', show: 'everyone', names: true }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/uploads/mara.webp');
    expect(container.querySelector('.voice-overlay-initial')?.textContent).toBe('R');
  });
});
