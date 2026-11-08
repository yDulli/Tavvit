import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { initI18n } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { isElectron } from '../../platform/platform';
import { copyImageFrom, copyImageToClipboard, saveImage, saveImageFrom } from '../../utils/imageActions';
import { MediaViewer } from './MediaViewer';

// The media viewer (docs/systems/embeds.md, "The media viewer"): one picture or several with a
// strip, moving along by arrows, keys and the strip, closing by its X, Escape or a click beside
// the picture, and offering the message's Reply and Forward where it came with them.

vi.mock('../../platform/platform', () => ({
  isElectron: vi.fn(),
}));

vi.mock('../../utils/imageActions', () => ({
  saveImage: vi.fn(),
  copyImageToClipboard: vi.fn(),
  copyImageFrom: vi.fn(),
  saveImageFrom: vi.fn(),
}));

const PICTURES = [1, 2, 3].map((n) => ({ url: `/full-${n}.png`, thumb: `/thumb-${n}.png`, alt: n === 2 ? 'The second' : null }));

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  cleanup();
  useUIStore.getState().closeImagePreview();
});

describe('MediaViewer', () => {
  beforeEach(() => {
    vi.mocked(isElectron).mockReturnValue(false);
    useUIStore.setState({
      activeModal: 'imagePreview',
      mediaViewer: { items: [{ url: '/test-image.png' }], index: 0 },
    });
  });

  it('covers the complete browser viewport', () => {
    const { container } = render(<MediaViewer />);

    expect(container.firstElementChild).toHaveClass('top-0');
    expect(container.firstElementChild).not.toHaveClass('top-[var(--titlebar-inset)]');
  });

  it('stays below the native window controls in Electron', () => {
    vi.mocked(isElectron).mockReturnValue(true);

    const { container } = render(<MediaViewer />);

    expect(container.firstElementChild).toHaveClass('top-[var(--titlebar-inset)]');
    expect(container.firstElementChild).not.toHaveClass('top-0');
  });

  it('shows one picture without a strip, arrows or the message\'s actions', () => {
    render(<MediaViewer />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/test-image.png');
    expect(screen.queryByRole('group', { name: 'Pictures' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next picture' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    expect(copyImageToClipboard).toHaveBeenCalledWith('/test-image.png');
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(saveImage).toHaveBeenCalledWith('/test-image.png', undefined);
  });
});

describe('several pictures', () => {
  beforeEach(() => {
    vi.mocked(isElectron).mockReturnValue(false);
  });

  it('opens on the one asked for and moves along by arrows, keys and the strip, round the end', () => {
    useUIStore.getState().openMediaViewer({ items: PICTURES, index: 1 });
    render(<MediaViewer />);
    const shown = () => screen.getAllByRole('img').find((img) => img.getAttribute('src')?.startsWith('/full'))!;
    expect(shown()).toHaveAttribute('src', '/full-2.png');
    expect(shown()).toHaveAttribute('alt', 'The second');
    expect(screen.getByText('2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(shown()).toHaveAttribute('src', '/full-3.png');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(shown()).toHaveAttribute('src', '/full-1.png');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(shown()).toHaveAttribute('src', '/full-3.png');
    fireEvent.click(screen.getByRole('button', { name: 'Picture 1 of 3' }));
    expect(shown()).toHaveAttribute('src', '/full-1.png');
    expect(screen.getByRole('button', { name: 'Picture 1 of 3' })).toHaveAttribute('aria-current', 'true');
  });

  it('closes by Escape and by a click beside the picture, not on it', () => {
    useUIStore.getState().openMediaViewer({ items: PICTURES, index: 0 });
    const { unmount } = render(<MediaViewer />);
    fireEvent.click(screen.getAllByRole('img')[0]!);
    expect(useUIStore.getState().mediaViewer).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUIStore.getState().mediaViewer).toBeNull();
    unmount();

    useUIStore.getState().openMediaViewer({ items: PICTURES, index: 0 });
    render(<MediaViewer />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(useUIStore.getState().mediaViewer).toBeNull();
  });

  it('replies to and forwards the message it came with, closing first', () => {
    const onReply = vi.fn();
    const onForward = vi.fn();
    useUIStore.getState().openMediaViewer({ items: PICTURES, index: 0, onReply, onForward });
    render(<MediaViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().mediaViewer).toBeNull();

    act(() => useUIStore.getState().openMediaViewer({ items: PICTURES, index: 0, onReply, onForward }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().mediaViewer).toBeNull();
  });

  it('copies and saves a picture this page cannot fetch itself through its loader, under the post\'s link', () => {
    const loadFile = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }));
    useUIStore.getState().openMediaViewer({
      items: [{ url: 'https://cdn.bsky.app/img/f', pageUrl: 'https://bsky.app/profile/bsky.app/post/3abc', loadFile, filename: 'bluesky-bsky.app-1' }],
      index: 0,
    });
    render(<MediaViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    expect(copyImageFrom).toHaveBeenCalledWith(loadFile, 'https://bsky.app/profile/bsky.app/post/3abc');
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(saveImageFrom).toHaveBeenCalledWith(loadFile, 'bluesky-bsky.app-1', 'https://cdn.bsky.app/img/f');
  });
});
