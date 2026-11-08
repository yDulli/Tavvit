import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The way into the theme studio asks the session store whether someone is signed in, and that
// store reaches the voice code, whose noise filter needs Web Audio, which jsdom does not have.
vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { AccessibilityPanel } from './AccessibilityPanel';
import { AppearancePanel } from './AppearancePanel';
import { LanguagePanel } from './LanguagePanel';

afterEach(cleanup);

describe('AppearancePanel', () => {
  // Both controls are stored per device and work on the login screen, which is
  // why they live here rather than with the account-owned settings.
  it('leaves language and interface scale to their own tabs', () => {
    const { container } = render(<AppearancePanel />);
    expect(container.querySelector('#language-select')).toBeNull();
    expect(container.querySelector('#interface-scale')).toBeNull();
    cleanup();
    const language = render(<LanguagePanel />);
    expect(language.container.querySelector('#language-select')).not.toBeNull();
    cleanup();
    const access = render(<AccessibilityPanel />);
    expect(access.container.querySelector('#interface-scale')).not.toBeNull();
  });
});
