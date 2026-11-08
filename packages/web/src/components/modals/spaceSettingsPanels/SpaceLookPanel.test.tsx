import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { initI18n } from '../../../i18n';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { useLooksStore } from '../../../stores/looksStore';
import { useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { CARBON_SETTINGS, DEFAULT_APPEARANCE, THEME_PRESETS } from '../../../utils/appTheme';
import { SpaceLookPanel } from './SpaceLookPanel';

// Space settings → Look: the space takes the colours of one of the chooser's looks, or none again.

const updateSpace = vi.fn(async () => {});

function spaceWith(look: unknown) {
  useSpaceStore.setState({
    spaces: [{ id: 's1', name: 'Night Shift', look, _instanceOrigin: '' }] as unknown as TaggedSpace[],
    updateSpace,
  });
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  updateSpace.mockClear();
  useAppearanceStore.setState({ ...DEFAULT_APPEARANCE, accent: '#c0283f' });
  useLooksStore.setState({
    looks: [{ id: 'l1', name: 'Plum evening', savedAt: 1, look: { surface: THEME_PRESETS.plum, accent: null, light: 'on', corners: 'round', font: 'inter', avatarShape: 'circle', messageStyle: 'rows', density: 'cozy' } }],
  });
});

afterEach(() => {
  cleanup();
  useSpaceStore.setState({ spaces: [] });
});

describe('a space\'s look in its settings', () => {
  it('takes the colours of the look chosen, and only them', async () => {
    spaceWith(null);
    render(<MemoryRouter><SpaceLookPanel spaceId="s1" /></MemoryRouter>);
    expect(screen.getByText('This space shows in each member\'s own colours.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Your current look/ })); });
    expect(updateSpace).toHaveBeenCalledWith('s1', { look: { ...CARBON_SETTINGS, accent: '#c0283f' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Plum evening/ })); });
    expect(updateSpace).toHaveBeenLastCalledWith('s1', { look: { ...THEME_PRESETS.plum, accent: null } });
  });

  it('shows the colours chosen, marks their look, and takes them away again', async () => {
    spaceWith({ ...THEME_PRESETS.plum, accent: null });
    render(<MemoryRouter><SpaceLookPanel spaceId="s1" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Plum evening/ })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove' })); });
    expect(updateSpace).toHaveBeenCalledWith('s1', { look: null });
  });
});
