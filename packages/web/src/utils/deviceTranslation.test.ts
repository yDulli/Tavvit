import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDeviceTranslationForTests, translateOnDevice } from './deviceTranslation';

const electron = vi.hoisted(() => ({ value: false }));
vi.mock('../platform/platform', () => ({ isElectron: () => electron.value }));

const detect = vi.fn();
const availability = vi.fn();
const create = vi.fn();
const translate = vi.fn();

function install(): void {
  vi.stubGlobal('Translator', { availability, create });
  vi.stubGlobal('LanguageDetector', { availability: async () => 'available', create: async () => ({ detect }) });
}

beforeEach(() => {
  __resetDeviceTranslationForTests();
  electron.value = false;
  detect.mockReset().mockResolvedValue([{ detectedLanguage: 'en', confidence: 0.95 }]);
  availability.mockReset().mockResolvedValue('available');
  translate.mockReset().mockImplementation(async (text: string) => text.toUpperCase());
  create.mockReset().mockResolvedValue({ translate });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the browser\'s own translator', () => {
  it('is not there in most browsers, and nothing is tried', async () => {
    expect(await translateOnDevice('Hello', 'de', () => {})).toBeNull();
  });

  it('translates the words and leaves the rest', async () => {
    install();
    const result = await translateOnDevice('Hello <@1> and `code`', 'de', () => {});
    expect(result).toEqual({ text: 'HELLO <@1> AND `code`', source: 'en', same: false });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'en', targetLanguage: 'de' }));
  });

  it('does not translate what is in that language already', async () => {
    install();
    detect.mockResolvedValue([{ detectedLanguage: 'de-AT', confidence: 0.9 }]);
    expect(await translateOnDevice('Servus', 'de', () => {})).toEqual({ text: 'Servus', source: 'de', same: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('has nothing to do for a message with no words', async () => {
    install();
    expect(await translateOnDevice('123 🎉', 'de', () => {})).toEqual({ text: '123 🎉', source: null, same: true });
    expect(detect).not.toHaveBeenCalled();
  });

  it('leaves it to others when it is not sure of the language', async () => {
    install();
    detect.mockResolvedValue([{ detectedLanguage: 'en', confidence: 0.2 }]);
    expect(await translateOnDevice('ok', 'de', () => {})).toBeNull();
    detect.mockResolvedValue([{ detectedLanguage: 'und', confidence: 0.9 }]);
    expect(await translateOnDevice('ok', 'de', () => {})).toBeNull();
    detect.mockResolvedValue([]);
    expect(await translateOnDevice('ok', 'de', () => {})).toBeNull();
  });

  it('leaves it to others for a pair of languages it does not have', async () => {
    install();
    availability.mockResolvedValue('unavailable');
    expect(await translateOnDevice('Hello', 'de', () => {})).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('says when a language pack has to come first, and not when it is there', async () => {
    install();
    const downloading = vi.fn();
    await translateOnDevice('Hello', 'de', downloading);
    expect(downloading).not.toHaveBeenCalled();
    __resetDeviceTranslationForTests();
    availability.mockResolvedValue('downloadable');
    await translateOnDevice('Hello', 'de', downloading);
    expect(downloading).toHaveBeenCalledTimes(1);
  });

  it('keeps a translator for the next message', async () => {
    install();
    await translateOnDevice('Hello', 'de', () => {});
    await translateOnDevice('World', 'de', () => {});
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('is not asked in the desktop app, where the question never comes back', async () => {
    install();
    electron.value = true;
    expect(await translateOnDevice('Hello', 'de', () => {})).toBeNull();
    expect(detect).not.toHaveBeenCalled();
  });

  it('gives up on a browser that lists it and never answers, and does not wait for it again', async () => {
    vi.useFakeTimers();
    install();
    availability.mockReturnValue(new Promise(() => {}));
    const first = translateOnDevice('Hello', 'de', () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await first).toBeNull();
    availability.mockClear();
    expect(await translateOnDevice('Hello', 'de', () => {})).toBeNull();
    expect(availability).not.toHaveBeenCalled();
  });

  it('waits for a language pack as long as it moves, and not once it stands still', async () => {
    vi.useFakeTimers();
    install();
    availability.mockResolvedValue('downloadable');
    let moved: EventTarget | null = null;
    create.mockImplementation((options: { monitor: (monitor: EventTarget) => void }) => {
      moved = new EventTarget();
      options.monitor(moved);
      return new Promise(() => {});
    });
    const running = translateOnDevice('Hello', 'de', () => {});
    await vi.advanceTimersByTimeAsync(170_000);
    moved!.dispatchEvent(new Event('downloadprogress'));
    await vi.advanceTimersByTimeAsync(170_000);
    let done = false;
    void running.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await running).toBeNull();
  });

  it('leaves it to others when it fails, and starts clean the next time', async () => {
    install();
    create.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(await translateOnDevice('Hello', 'de', () => {})).toBeNull();
    expect(await translateOnDevice('Hello', 'de', () => {})).toMatchObject({ text: 'HELLO' });
  });
});
