import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// voiceStore imports AudioManager, whose AudioWorklet module jsdom cannot evaluate.
vi.mock('../../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const prefetch = vi.hoisted(() => vi.fn());
vi.mock('../../../camera', () => ({
  loadBackgroundProcessor: async () => ({ prefetchBackgroundAssets: prefetch }),
}));

// The picture stays on the device in IndexedDB, which jsdom has not: the store is the real
// shape, the reading and writing are spies.
const own = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), forget: vi.fn() }));
vi.mock('../../../camera/ownImage', async () => {
  const { create } = await import('zustand');
  const useOwnImage = create<{ status: 'unknown' | 'none' | 'ready'; url: string | null }>(() => ({ status: 'none', url: null }));
  class OwnImageRejected extends Error {
    constructor(readonly problem: string) {
      super(problem);
    }
  }
  return { useOwnImage, loadOwnImage: own.load, saveOwnImage: own.save, forgetOwnImage: own.forget, OwnImageRejected };
});

import { CameraBackgroundPicker } from './CameraBackgroundPicker';
import { useVoiceStore } from '../../../stores/voiceStore';
import { useCameraStrain } from '../../../camera/strain';
import { OwnImageRejected, useOwnImage } from '../../../camera/ownImage';

const radio = (name: string | RegExp) => screen.getByRole('radio', { name });

function renderPicker() {
  return render(
    <>
      <span id="background-label">Background</span>
      <CameraBackgroundPicker labelledBy="background-label" preview="off" />
    </>,
  );
}

beforeEach(() => {
  useVoiceStore.setState({ cameraBackground: { kind: 'none' } });
  useOwnImage.setState({ status: 'none', url: null });
  own.load.mockReset();
  own.save.mockReset();
  own.forget.mockReset();
  prefetch.mockReset();
});

afterEach(() => {
  useCameraStrain.setState({ strained: false });
  vi.restoreAllMocks();
});

describe('the camera background picker', () => {
  it('offers the room as it is, two blurs, the scenes and a picture of one\'s own, as one choice', () => {
    renderPicker();
    expect(screen.getByRole('radiogroup', { name: 'Background' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      'None', 'Soft blur', 'Strong blur', 'Graphite', 'Tavern', 'Library', 'Night window', 'Greenhouse', 'Add a picture',
    ]);
    expect(radio('None')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Your picture stays here and is never uploaded/)).toBeInTheDocument();
  });

  it('takes a choice at once, and fetches what the processor needs ahead of the camera', async () => {
    renderPicker();
    fireEvent.click(radio('Tavern'));
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'scene', scene: 'tavern' });
    expect(radio('Tavern')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(prefetch).toHaveBeenCalled());
  });

  it('moves the choice with the arrow keys', () => {
    renderPicker();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'blur', strength: 'light' });
  });

  it('opens the file dialog for a picture of one\'s own before there is one, choosing nothing yet', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderPicker();
    fireEvent.click(radio('Add a picture'));
    expect(click).toHaveBeenCalled();
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'none' });
  });

  it('keeps a picked picture on the device and chooses it', async () => {
    own.save.mockImplementation(async () => {
      useOwnImage.setState({ status: 'ready', url: 'blob:own' });
    });
    const { container } = renderPicker();
    const file = new File(['x'], 'beach.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    });
    expect(own.save).toHaveBeenCalledWith(file);
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'own' });
    expect(radio('Your picture')).toHaveAttribute('aria-checked', 'true');
  });

  it('says why a file could not become the background', async () => {
    own.save.mockRejectedValue(new OwnImageRejected('tooLarge'));
    const { container } = renderPicker();
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'huge.png')] } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('That file is over 25 MB.');
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'none' });
  });

  it('lets the picture be replaced or removed once there is one; removing it shows the room again', async () => {
    useOwnImage.setState({ status: 'ready', url: 'blob:own' });
    useVoiceStore.setState({ cameraBackground: { kind: 'own' } });
    renderPicker();
    expect(screen.getByRole('button', { name: 'Choose another picture' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove picture' }));
    });
    expect(own.forget).toHaveBeenCalled();
    expect(useVoiceStore.getState().cameraBackground).toEqual({ kind: 'none' });
  });

  it('says when the chosen picture is no longer on this device', () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'own' } });
    renderPicker();
    expect(screen.getByText(/no longer on this device/)).toBeInTheDocument();
  });

  it('suggests a lighter choice when the device cannot keep up with a background', () => {
    useVoiceStore.setState({ cameraBackground: { kind: 'scene', scene: 'library' } });
    useCameraStrain.setState({ strained: true });
    renderPicker();
    expect(screen.getByText(/struggling to keep up/)).toBeInTheDocument();
  });
});
