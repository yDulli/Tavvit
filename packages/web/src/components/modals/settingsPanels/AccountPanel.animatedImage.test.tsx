import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { User } from '@backspace/shared';
import { MAX_PROFILE_IMAGE_SOURCE_BYTES } from '@backspace/shared/src/profileImage';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

// jsdom has no layout, so the real cropper never reports an area. This one reports a fixed one.
const CROP = { x: 10, y: 20, width: 30.4, height: 29.6 };
vi.mock('react-easy-crop', () => ({
  default: function MockCropper({ onCropComplete }: { onCropComplete: (area: unknown, pixels: unknown) => void }) {
    // After the modal's own reset on open, the way the real cropper reports once it has laid out.
    useEffect(() => {
      const timer = setTimeout(() => onCropComplete({}, CROP), 0);
      return () => clearTimeout(timer);
    }, [onCropComplete]);
    return <div data-testid="cropper" />;
  },
}));

const cropImage = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/cropImage', () => ({ cropImage }));

import { AccountPanel } from './AccountPanel';
import { useAuthStore } from '../../../stores/authStore';
import { api } from '../../../api/client';

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A GIF with `frames` tiny frames. */
function gifBytes(frames: number): Uint8Array {
  const bytes: number[] = [...text('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  for (let i = 0; i < frames; i++) {
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

function file(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

let profileImage: ReturnType<typeof vi.spyOn>;
let update: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cropImage.mockReset();
  cropImage.mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));
  useAuthStore.setState({ user: { id: 'me', username: 'me', displayName: 'Me', createdAt: 1, status: 'online' } as User, myRowIds: new Map(), trueHomeStatus: null });
  profileImage = vi.spyOn(api.users, 'profileImage').mockResolvedValue({ filename: '777.webp' });
  update = vi.spyOn(api.users, 'update').mockImplementation(async (data) => ({ id: 'me', username: 'me', createdAt: 1, ...data } as User));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The first hidden file input is the avatar's, the second the banner's. */
function input(kind: 'avatar' | 'banner'): HTMLInputElement {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  return inputs[kind === 'avatar' ? 0 : 1]!;
}

describe('an animated avatar', () => {
  it('is cut by the server from the original, with the chosen area in whole pixels', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    const original = gifBytes(3);
    fireEvent.change(input('avatar'), { target: { files: [file(original, 'dance.gif', 'image/gif')] } });

    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(profileImage).toHaveBeenCalledOnce());
    expect(profileImage).toHaveBeenCalledWith({
      kind: 'avatar',
      image: toBase64(original),
      crop: { x: 10, y: 20, width: 30, height: 30 },
    });
    // The browser's own cropper, which would flatten it to one frame, is not used.
    expect(cropImage).not.toHaveBeenCalled();
  });

  it('is kept in the next profile update under the file the server stored', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    fireEvent.change(input('avatar'), { target: { files: [file(gifBytes(2), 'dance.gif', 'image/gif')] } });
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(profileImage).toHaveBeenCalled());

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toMatchObject({ avatar: '777.webp' });
  });

  it('shows the reason and keeps the old picture when the server refuses', async () => {
    profileImage.mockRejectedValue(Object.assign(new Error('too big'), { code: 'profile_image_too_large' }));
    const user = userEvent.setup();
    render(<AccountPanel />);
    fireEvent.change(input('avatar'), { target: { files: [file(gifBytes(2), 'dance.gif', 'image/gif')] } });
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/too large|too big/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('is turned away before the crop when the original is larger than the server takes', async () => {
    render(<AccountPanel />);
    const huge = file(gifBytes(2), 'huge.gif', 'image/gif');
    Object.defineProperty(huge, 'size', { value: MAX_PROFILE_IMAGE_SOURCE_BYTES + 1 });
    fireEvent.change(input('avatar'), { target: { files: [huge] } });
    expect(await screen.findByText('Animated pictures can be at most 12 MB. Choose a smaller one.')).toBeInTheDocument();
    expect(screen.queryByTestId('cropper')).not.toBeInTheDocument();
    expect(profileImage).not.toHaveBeenCalled();
  });
});

describe('a still picture', () => {
  it('is still cropped in the browser, never sent to the animation endpoint', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    // One frame only: a GIF that does not move is a still image.
    fireEvent.change(input('avatar'), { target: { files: [file(gifBytes(1), 'still.gif', 'image/gif')] } });
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(cropImage).toHaveBeenCalledOnce());
    expect(profileImage).not.toHaveBeenCalled();
  });

  it('also covers a PNG or JPEG, whatever its size', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    fireEvent.change(input('avatar'), { target: { files: [file(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'a.png', 'image/png')] } });
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(cropImage).toHaveBeenCalledOnce());
    expect(profileImage).not.toHaveBeenCalled();
  });
});

describe('an animated banner', () => {
  it('goes the same way and asks for a banner', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    fireEvent.change(input('banner'), { target: { files: [file(gifBytes(2), 'wave.gif', 'image/gif')] } });
    await screen.findByTestId('cropper');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(profileImage).toHaveBeenCalledOnce());
    expect(profileImage.mock.calls[0]![0]).toMatchObject({ kind: 'banner' });
  });
});
