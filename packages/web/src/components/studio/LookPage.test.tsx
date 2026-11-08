import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../legal/LegalLinks', () => ({ LegalLinks: () => null }));

import { initI18n } from '../../i18n';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { useLooksStore } from '../../stores/looksStore';
import { DEFAULT_APPEARANCE, THEME_PRESETS } from '../../utils/appTheme';
import { encodeLook, type Look } from '../../utils/looks';
import { LookPage } from './LookPage';

// A shared look (`/look#…`): read from the link alone, shown, and put on this device on request,
// where it is kept among the person's looks; what helps them read stays theirs.

const LOOK: Look = {
  surface: THEME_PRESETS.plum,
  accent: null,
  light: 'on',
  corners: 'round',
  font: 'inter',
  avatarShape: 'circle',
  messageStyle: 'bubbles',
  density: 'spacious',
};

function open(hash: string) {
  return render(
    <MemoryRouter initialEntries={[`/look${hash}`]}>
      <Routes>
        <Route path="/look" element={<LookPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  useAppearanceStore.setState({ ...DEFAULT_APPEARANCE, contrast: 'high', chatTextScale: 1.25 });
  useLooksStore.setState({ looks: [] });
});

afterEach(cleanup);

describe('a shared look', () => {
  it('says so when the link holds none', () => {
    open('#not-a-look');
    expect(screen.getByRole('heading', { name: 'No look here' })).toBeInTheDocument();
  });

  it('shows what it is, and puts it on and keeps it on request, leaving what helps reading alone', () => {
    open(`#${encodeLook(LOOK, 'Plum evening')}`);
    expect(screen.getByRole('heading', { name: 'Plum evening' })).toBeInTheDocument();
    expect(screen.getByText('Inter')).toBeInTheDocument();
    expect(screen.getByText('Plum')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use this look' }));
    expect(useAppearanceStore.getState()).toMatchObject({ theme: 'plum', font: 'inter', messageStyle: 'bubbles', contrast: 'high', chatTextScale: 1.25 });
    expect(useLooksStore.getState().looks.map((saved) => saved.name)).toEqual(['Plum evening']);
    expect(screen.getByText(/this look is yours now/)).toBeInTheDocument();
  });
});
