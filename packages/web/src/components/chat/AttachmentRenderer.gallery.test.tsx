import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@backspace/shared';
import { initI18n } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { AttachmentList, AttachmentRenderer } from './AttachmentRenderer';
import { mediaBox } from './mediaBox';

vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

function attachment(name: string, mimetype: string, size: Partial<Attachment> = {}): Attachment {
  return {
    id: name,
    filename: name,
    originalName: name,
    mimetype,
    size: 1024,
    thumbnailFilename: null,
    width: null,
    height: null,
    duration: null,
    ...size,
  } as Attachment;
}

const picture = (name: string) => attachment(name, 'image/png', { width: 800, height: 600 });

/** The cells of the gallery the first picture is in, as their column spans. */
function cellSpans(): string[] {
  const first = screen.getAllByRole('button')[0]!;
  const cells = Array.from(first.closest('.grid-cols-6')!.children);
  return cells.map((cell) => (cell.className.includes('col-span-3') ? 'wide' : 'square'));
}

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  cleanup();
  useUIStore.getState().closeImagePreview();
});

describe('AttachmentList', () => {
  it('shows one picture at its own proportions, outside any gallery', () => {
    const { container } = render(<AttachmentList attachments={[picture('a.png')]} />);
    expect(container.querySelector('.grid-cols-6')).toBeNull();
    expect(screen.getByRole('button', { name: 'a.png' }).style.aspectRatio).toBe('800/600');
  });

  it('lays two pictures out as a row of two', () => {
    render(<AttachmentList attachments={[picture('a.png'), picture('b.png')]} />);
    expect(cellSpans()).toEqual(['wide', 'wide']);
  });

  it('never ends a gallery on a lone picture', () => {
    render(<AttachmentList attachments={['a', 'b', 'c', 'd', 'e'].map((n) => picture(`${n}.png`))} />);
    expect(cellSpans()).toEqual(['wide', 'wide', 'square', 'square', 'square']);
    cleanup();
    render(<AttachmentList attachments={['a', 'b', 'c', 'd'].map((n) => picture(`${n}.png`))} />);
    expect(cellSpans()).toEqual(['wide', 'wide', 'wide', 'wide']);
    cleanup();
    render(<AttachmentList attachments={['a', 'b', 'c'].map((n) => picture(`${n}.png`))} />);
    expect(cellSpans()).toEqual(['square', 'square', 'square']);
  });

  it('keeps the order of mixed attachments: a file splits two runs of pictures', () => {
    const { container } = render(
      <AttachmentList attachments={[picture('a.png'), picture('b.png'), attachment('notes.txt', 'text/plain'), picture('c.png')]} />,
    );
    expect(container.querySelectorAll('.grid-cols-6')).toHaveLength(1);
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names[0]).toBe('a.png');
    expect(names[1]).toBe('b.png');
    expect(names[2]).toContain('notes.txt');
    expect(names[3]).toBe('c.png');
  });

  it('opens the original of a picture in a gallery, not its thumbnail', () => {
    const open = vi.spyOn(useUIStore.getState(), 'openImagePreview');
    useUIStore.setState({ openImagePreview: open });
    render(<AttachmentList attachments={[
      attachment('a.png', 'image/png', { thumbnailFilename: 'a-thumb.png' }),
      picture('b.png'),
    ]} />);
    fireEvent.click(screen.getByAltText('a.png'));
    expect(open).toHaveBeenCalledWith('/api/uploads/a.png');
    expect(screen.getByAltText('a.png')).toHaveAttribute('src', '/api/uploads/a-thumb.png');
  });
});

describe('AttachmentRenderer', () => {
  it('names the picture for assistive technology and keeps its source for the sticker menu', () => {
    render(<AttachmentRenderer attachment={picture('a.png')} />);
    expect(screen.getByRole('button', { name: 'a.png' })).toBeInTheDocument();
    expect(screen.getByAltText('a.png')).toHaveAttribute('data-sticker-source', '/api/uploads/a.png');
  });
});

describe('mediaBox', () => {
  it('fits a picture inside 400 x 300 at its own proportions', () => {
    expect(mediaBox(1600, 900)).toEqual({ aspectRatio: '1600/900', width: 400 });
    // A tall picture is held by its height, not stretched to the full width.
    expect(mediaBox(900, 1400)).toEqual({ aspectRatio: '900/1400', width: 193 });
  });

  it('never enlarges a picture, but does enlarge a clip', () => {
    expect(mediaBox(96, 64)).toEqual({ aspectRatio: '96/64', width: 96 });
    expect(mediaBox(200, 100, { enlarge: true })).toEqual({ aspectRatio: '200/100', width: 400 });
  });

  it('reserves nothing without known dimensions', () => {
    expect(mediaBox(null, null)).toBeUndefined();
    expect(mediaBox(800, undefined)).toBeUndefined();
  });
});
