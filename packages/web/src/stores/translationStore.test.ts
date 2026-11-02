import { beforeEach, describe, expect, it, vi } from 'vitest';

const onDevice = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());
const serverTranslate = vi.hoisted(() => vi.fn());
const language = vi.hoisted(() => ({ value: 'de' }));

vi.mock('../utils/deviceTranslation', () => ({ translateOnDevice: onDevice }));
vi.mock('./spaceStore', () => ({
  getChannelOrigin: () => '',
  getApiForOrigin: () => ({ instance: { info }, messages: { translate: serverTranslate } }),
}));
vi.mock('../i18n', () => ({ getLanguage: () => language.value }));
vi.mock('../i18n/errors', () => ({ describeError: () => 'it failed' }));

import { __resetServerAnswersForTests, useTranslationStore } from './translationStore';
import { translationTarget, useTranslationTargetStore } from './translationTargetStore';

const entry = () => useTranslationStore.getState().entries.m1;
const translate = () => useTranslationStore.getState().translate('m1', 'Hello', 'c1');

beforeEach(() => {
  useTranslationTargetStore.setState({ chosenTarget: null });
  useTranslationStore.setState({ entries: {} });
  __resetServerAnswersForTests();
  onDevice.mockReset();
  info.mockReset();
  serverTranslate.mockReset();
  language.value = 'de';
  window.localStorage.clear();
});

describe('where a translation comes from', () => {
  it('goes by the language chosen under Settings', async () => {
    useTranslationTargetStore.getState().setChosenTarget('fr');
    onDevice.mockResolvedValue({ text: 'Bonjour', source: 'en', same: false });
    await translate();
    expect(onDevice).toHaveBeenCalledWith('Hello', 'fr', expect.any(Function));
  });

  it('takes the browser first, and asks no server', async () => {
    onDevice.mockResolvedValue({ text: 'Hallo', source: 'en', same: false });
    await translate();
    expect(entry()).toEqual({ status: 'done', content: 'Hello', text: 'Hallo', source: 'en' });
    expect(onDevice).toHaveBeenCalledWith('Hello', 'de', expect.any(Function));
    expect(info).not.toHaveBeenCalled();
  });

  it('goes to the server when the browser cannot and the server has a translator', async () => {
    onDevice.mockResolvedValue(null);
    info.mockResolvedValue({ translation: true });
    serverTranslate.mockResolvedValue({ text: 'Hallo', sourceLanguage: 'en', targetLanguage: 'de', sameLanguage: false });
    await translate();
    expect(serverTranslate).toHaveBeenCalledWith('m1', 'de');
    expect(entry()).toMatchObject({ status: 'done', text: 'Hallo', source: 'en' });
  });

  it('asks a server once whether it can', async () => {
    onDevice.mockResolvedValue(null);
    info.mockResolvedValue({ translation: true });
    serverTranslate.mockResolvedValue({ text: 'Hallo', sourceLanguage: 'en', targetLanguage: 'de', sameLanguage: false });
    await translate();
    await useTranslationStore.getState().translate('m2', 'Other', 'c1');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('sends nothing anywhere when neither can, and offers the link', async () => {
    onDevice.mockResolvedValue(null);
    info.mockResolvedValue({ translation: false });
    await translate();
    expect(serverTranslate).not.toHaveBeenCalled();
    expect(entry()).toEqual({ status: 'offer', content: 'Hello', target: 'de', error: null });
  });

  it('asks a server again that did not answer, and treats it as one that cannot', async () => {
    onDevice.mockResolvedValue(null);
    info.mockRejectedValueOnce(new Error('offline'));
    await translate();
    expect(entry()).toMatchObject({ status: 'offer', error: null });
    info.mockResolvedValue({ translation: true });
    serverTranslate.mockResolvedValue({ text: 'Hallo', sourceLanguage: 'en', targetLanguage: 'de', sameLanguage: false });
    await translate();
    expect(entry()).toMatchObject({ status: 'done' });
  });

  it('says why when the translator failed, and still offers the link', async () => {
    onDevice.mockResolvedValue(null);
    info.mockResolvedValue({ translation: true });
    serverTranslate.mockRejectedValue(new Error('no'));
    await translate();
    expect(entry()).toEqual({ status: 'offer', content: 'Hello', target: 'de', error: 'it failed' });
  });

  it('says when it is in that language already', async () => {
    onDevice.mockResolvedValue({ text: 'Hallo', source: 'de', same: true });
    await translate();
    expect(entry()).toEqual({ status: 'same', content: 'Hello', source: 'de', target: 'de' });
  });
});

describe('while it works', () => {
  it('says when a language has to come first', async () => {
    let finish: (value: null) => void = () => {};
    onDevice.mockImplementation((_content: string, _target: string, downloading: () => void) => {
      downloading();
      return new Promise((resolve) => { finish = resolve; });
    });
    const running = translate();
    await vi.waitFor(() => expect(entry()).toEqual({ status: 'working', content: 'Hello', downloading: true }));
    info.mockResolvedValue({ translation: false });
    finish(null);
    await running;
  });

  it('drops an answer once the person has hidden it', async () => {
    let finish: (value: { text: string; source: string; same: boolean }) => void = () => {};
    onDevice.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const running = translate();
    useTranslationStore.getState().hide('m1');
    finish({ text: 'Hallo', source: 'en', same: false });
    await running;
    expect(entry()).toBeUndefined();
  });
});

describe('the language', () => {
  it('is the app\'s, until one is chosen, and the choice is kept', () => {
    expect(translationTarget(null)).toBe('de');
    useTranslationTargetStore.getState().setChosenTarget('fr');
    expect(useTranslationTargetStore.getState().chosenTarget).toBe('fr');
    expect(window.localStorage.getItem('backspace-translate-target')).toBe('fr');
    expect(translationTarget('fr')).toBe('fr');
    useTranslationTargetStore.getState().setChosenTarget(null);
    expect(window.localStorage.getItem('backspace-translate-target')).toBeNull();
  });

  it('falls back to English where the app\'s language is no target', () => {
    language.value = 'xx';
    expect(translationTarget(null)).toBe('en');
  });

  it('forgets translations into the language chosen before', async () => {
    onDevice.mockResolvedValue({ text: 'Hallo', source: 'en', same: false });
    await translate();
    useTranslationTargetStore.getState().setChosenTarget('fr');
    expect(entry()).toBeUndefined();
  });
});
