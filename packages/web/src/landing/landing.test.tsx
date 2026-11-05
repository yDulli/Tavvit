import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_STORAGE_KEY, availableLanguages } from '../i18n/languages';
import de from '../locales/de/landing.json';
import en from '../locales/en/landing.json';
import { BOT_ROUTES } from '@backspace/shared/src/bots.js';
import { MAX_MESSAGE_LENGTH } from '@backspace/shared';
import { THEME_IDS } from '../utils/appTheme';
import { SESSION_TOKEN_KEY, showsLanding } from './entry';
import { EXAMPLE_ROUTE, exampleRequest } from './example';
import { LANDING_FIGURES } from './figures';
import { initLandingI18n } from './i18n';
import { LandingPage } from './LandingPage';

const here = dirname(fileURLToPath(import.meta.url));

/** The word for it in each language the page ships, in any form the catalogs could use. */
const ADVERTISES_THE_LICENCE_OR_HOSTING = /open[\s-]?source|self[\s-]?host|code is open|selbst[\s-]?gehost|c[oó]digo aberto|auto[\s-]?hosped|открыт\S*\s+(?:исходн\S*\s+)?код|код\s+открыт|сво[её]м сервере|开源|自托管|自建/i;

function setPath(path: string) {
  window.history.pushState({}, '', path);
}

function setDisplayMode(installedMode: string | null) {
  window.matchMedia = ((query: string) => ({
    matches: installedMode !== null && query === `(display-mode: ${installedMode})`,
  })) as unknown as typeof window.matchMedia;
}

describe('who sees the product page', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setPath('/');
    setDisplayMode(null);
  });

  afterEach(() => {
    delete (window as { backspace?: unknown }).backspace;
    delete (navigator as { standalone?: boolean }).standalone;
  });

  it('a visitor at the front door', () => {
    expect(showsLanding()).toBe(true);
  });

  it('nobody signed in on this browser', () => {
    window.localStorage.setItem(SESSION_TOKEN_KEY, 'token');
    expect(showsLanding()).toBe(false);
  });

  it('nobody on another address', () => {
    for (const path of ['/login', '/register', '/channels/@me', '/join/abc', '/imprint']) {
      setPath(path);
      expect(showsLanding()).toBe(false);
    }
  });

  it('nobody in the desktop app, which waits for a signal only the app sends', () => {
    (window as { backspace?: unknown }).backspace = {};
    expect(showsLanding()).toBe(false);
  });

  it('nobody in an installed web app', () => {
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
      setDisplayMode(mode);
      expect(showsLanding()).toBe(false);
    }
    setDisplayMode(null);
    (navigator as { standalone?: boolean }).standalone = true;
    expect(showsLanding()).toBe(false);
  });

  it('reads the key the sign-in writes', () => {
    const store = readFileSync(join(here, '..', 'stores', 'authStore.ts'), 'utf8');
    expect(store).toContain(`localStorage.setItem('${SESSION_TOKEN_KEY}'`);
  });

  // The page states these numbers without importing their modules (figures.ts says why).
  it('states the figures the app really has', () => {
    expect(LANDING_FIGURES.themes).toBe(THEME_IDS.length);
    expect(LANDING_FIGURES.characters).toBe(MAX_MESSAGE_LENGTH);
    const limits = readFileSync(join(here, '..', '..', '..', 'server', 'src', 'utils', 'groupDmLimits.ts'), 'utf8');
    expect(limits).toMatch(new RegExp(`GROUP_DM_MAX_MEMBERS\\s*=\\s*${LANDING_FIGURES.group}\\b`));
  });
});

describe('what a visitor is sent', () => {
  const importsOf = (file: string): string[] => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]!);
  };
  const landingFiles = readdirSync(here)
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => join(here, name));

  it.each(landingFiles)('%s stays out of the app', (file) => {
    for (const specifier of importsOf(file)) {
      expect(specifier).not.toMatch(/stores\/|api\/|components\/|hooks\/|\/App$|appBoot|i18n\/index|i18n\/resources|^\.\.\/i18n$/);
    }
  });

  // WCAG 2.2.2 would ask for a way to stop it, and the page has none because it needs none.
  it('moves nothing by itself', () => {
    expect(readFileSync(join(here, 'landing.css'), 'utf8')).not.toMatch(/\binfinite\b/);
  });

  it('main.tsx asks for the app only by a dynamic import', () => {
    const source = readFileSync(join(here, '..', 'main.tsx'), 'utf8');
    const staticImports = [...source.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    expect(staticImports).toEqual(['./styles/globals.css', './landing/entry', './publicPages/entry']);
  });
});

describe('the page', () => {
  beforeAll(async () => {
    // jsdom lays nothing out, so there is nothing to measure when headings are fitted.
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    await i18next.use(initReactI18next).init({
      lng: 'en',
      defaultNS: 'landing',
      ns: ['landing'],
      resources: { en: { landing: en } },
      interpolation: { escapeValue: false },
    });
  });

  function answerInfo(body: object) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers registration and login, and links the legal pages', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: 'https://example.org/source.tar.gz' });
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1, name: en.hero.title })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: en.nav.register })[0]).toHaveAttribute('href', '/register');
    expect(screen.getAllByRole('link', { name: en.nav.login })[0]).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: en.footer.imprint })).toHaveAttribute('href', '/imprint');
    expect(screen.getByRole('link', { name: en.footer.privacy })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: en.footer.terms })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: en.footer.report })).toHaveAttribute('href', '/report');
    await waitFor(() => expect(screen.getByRole('link', { name: en.footer.source })).toHaveAttribute('href', 'https://example.org/source.tar.gz'));
    expect(document.title).toBe(en.meta.title);
  });

  it('links the source code once, from the footer (AGPL section 13)', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: 'https://example.org/source.tar.gz' });
    const { container } = render(<LandingPage />);
    const link = await screen.findByRole('link', { name: en.footer.source });
    expect(link.closest('footer')).not.toBeNull();
    expect(container.querySelectorAll('a[href="https://example.org/source.tar.gz"]')).toHaveLength(1);
    expect(container.textContent).not.toMatch(ADVERTISES_THE_LICENCE_OR_HOSTING);
  });

  it('stops offering registration on a server that takes no new accounts', async () => {
    answerInfo({ registrationOpen: false, sourceCodeUrl: 'https://example.org/source.tar.gz' });
    render(<LandingPage />);
    await waitFor(() => expect(screen.queryByRole('link', { name: en.nav.register })).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: en.cta.register })).not.toBeInTheDocument();
    expect(screen.getByText(en.cta.closed)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: en.nav.login }).length).toBeGreaterThan(1);
  });

  it('still works when the server does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<LandingPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getAllByRole('link', { name: en.nav.register })[0]).toHaveAttribute('href', '/register');
  });

  it('shows what is new around the conversation and leads to the docs and the help', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null });
    render(<LandingPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    for (const title of [en.around.title, en.developers.title, en.questions.title]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: en.developers.link })).toHaveAttribute('href', '/developers');
    expect(screen.getByRole('link', { name: en.questions.more })).toHaveAttribute('href', '/help');
  });

  it('answers its questions in plain details, which open without a script', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null });
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelectorAll('details')).toHaveLength(Object.keys(en.questions.items).length);
    expect(screen.getByText(en.questions.items.moving.q).closest('summary')).not.toBeNull();
  });

  describe('the channel to try', () => {
    const composer = () => screen.getByRole('textbox', { name: en.demo.placeholder });
    const say = (text: string) => {
      fireEvent.change(composer(), { target: { value: text } });
      fireEvent.submit(composer().closest('form')!);
    };

    beforeEach(() => {
      answerInfo({ registrationOpen: true, sourceCodeUrl: null });
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers someone who writes, and sends nothing anywhere', async () => {
      render(<LandingPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const before = vi.mocked(fetch).mock.calls.length;
      const stored = window.localStorage.length;
      say('Hello from a visitor');
      expect(screen.getByText('Hello from a visitor')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.getByText('Lena is typing…')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(screen.getByText(en.demo.replies.lena)).toBeInTheDocument();
      expect(vi.mocked(fetch).mock.calls.length).toBe(before);
      expect(window.localStorage.length).toBe(stored);
    });

    it('says each line once: when everyone has answered, people only react', async () => {
      render(<LandingPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      for (let turn = 0; turn < 8; turn += 1) {
        say(`Message ${turn}`);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      }
      expect(screen.getAllByText(en.demo.replies.lena)).toHaveLength(1);
      expect(screen.getByText(en.demo.replies.end)).toBeInTheDocument();
    });

    it('shows what someone types as words, never as markup or a link', async () => {
      const { container } = render(<LandingPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      say('<img src=x onerror=alert(1)> https://example.org');
      expect(screen.getByText('<img src=x onerror=alert(1)> https://example.org')).toBeInTheDocument();
      expect(container.querySelector('.lp-demo-list img, .lp-demo-list a')).toBeNull();
    });

    it('takes no empty message, and offers a seat only after a first one', async () => {
      render(<LandingPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const lines = document.querySelectorAll('.lp-demo-line').length;
      say('   ');
      expect(document.querySelectorAll('.lp-demo-line').length).toBe(lines);
      expect(screen.queryByRole('link', { name: en.demo.cta })).not.toBeInTheDocument();
      say('Hi');
      expect(screen.getByRole('link', { name: en.demo.cta })).toHaveAttribute('href', '/register');
    });

    it('lets a reaction be added and taken back', async () => {
      render(<LandingPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const wave = screen.getByRole('button', { name: /👋/ });
      expect(wave).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(wave);
      expect(wave).toHaveAttribute('aria-pressed', 'true');
      expect(wave).toHaveTextContent('4');
      fireEvent.click(wave);
      expect(wave).toHaveTextContent('3');
    });
  });

  it('shows a group\'s picture when its chip is chosen, and goes on with the arrow keys', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null });
    render(<LandingPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole('img', { name: en.crowds.alts.raid })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: en.crowds.books }));
    expect(screen.getByRole('img', { name: en.crowds.alts.books })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: en.crowds.alts.raid })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: en.crowds.raid })).toHaveAttribute('aria-selected', 'true');
  });

  describe('signs of life', () => {
    function answerBy(info: object, status: object | null) {
      vi.stubGlobal('fetch', vi.fn(async (address: string) => {
        if (address === '/api/status') return status ? { ok: true, json: async () => status } : { ok: false };
        return { ok: true, json: async () => info };
      }));
    }

    it('says the chat runs and which version, each with a way to read more', async () => {
      answerBy({ registrationOpen: true, sourceCodeUrl: null, version: '9.9.9' }, { services: { chat: 'ok' } });
      render(<LandingPage />);
      expect(await screen.findByRole('link', { name: en.life.ok })).toHaveAttribute('href', '/status');
      expect(await screen.findByRole('link', { name: 'Version 9.9.9' })).toHaveAttribute('href', '/changelog');
    });

    it('says so when the chat is down', async () => {
      answerBy({ registrationOpen: true, sourceCodeUrl: null }, { services: { chat: 'down' } });
      render(<LandingPage />);
      expect(await screen.findByRole('link', { name: en.life.down })).toBeInTheDocument();
    });

    it('claims nothing when the server does not answer', async () => {
      answerBy({ registrationOpen: true, sourceCodeUrl: null }, null);
      render(<LandingPage />);
      await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/status'));
      expect(screen.queryByRole('link', { name: en.life.ok })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: en.life.down })).not.toBeInTheDocument();
    });
  });

  it('names two-factor sign-in only where the server has it', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null, twoFactor: false });
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 3, name: en.privacy.points.twoFactor.title })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: en.privacy.points.twoFactor.title })).not.toBeInTheDocument());
    expect(screen.queryByText(en.features.items.twoFactor)).not.toBeInTheDocument();
  });

  it('offers the download to someone on Windows, and a look around to everyone else', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null });
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgent.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const { unmount } = render(<LandingPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: en.hero.explore })).not.toBeInTheDocument();
    unmount();
    userAgent.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: en.hero.explore })).toHaveAttribute('href', '#features');
    userAgent.mockRestore();
  });

  it('keeps every way out of the page', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: 'https://example.org/source.tar.gz', version: '9.9.9' });
    const { container } = render(<LandingPage />);
    await screen.findByRole('link', { name: en.footer.source });
    const links = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    for (const address of ['/', '#features', '/download', '/developers', '/help', '/changelog', '/status', '/login', '/register', '/imprint', '/privacy', '/terms', '/report', 'https://example.org/source.tar.gz']) {
      expect(links).toContain(address);
    }
  });

  it('shows code a bot can really run, on the address the visitor is on', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null });
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(BOT_ROUTES.some((route) => route.method === EXAMPLE_ROUTE.method && route.path === EXAMPLE_ROUTE.path)).toBe(true);
    expect(exampleRequest('https://chat.example')).toContain('https://chat.example/api/channels/<channel id>/messages');
    expect(container.querySelector('.lp-code code')?.textContent).toBe(exampleRequest(window.location.origin));
  });

  // The page reads as a space, and Ctrl K opens its switcher as it does in the app.
  it('opens its own switcher with Ctrl K, narrows it by typing and closes it with Escape', async () => {
    answerInfo({ registrationOpen: true, sourceCodeUrl: null });
    render(<LandingPage />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: en.jump.open });
    const field = within(dialog).getByRole('combobox');
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.change(field, { target: { value: en.chapters.voice } });
    expect(within(dialog).getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringContaining(en.chapters.voice)]);
    fireEvent.change(field, { target: { value: 'nothing by this name' } });
    expect(within(dialog).getByRole('status')).toHaveTextContent('nothing by this name');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('what a shared link and the page say about Tavvit', () => {
  const webRoot = join(here, '..', '..');
  const catalogFile = (language: string) => join(here, '..', 'locales', language, 'landing.json');
  const codes = availableLanguages.map((language) => language.code);

  const stringsOf = (value: unknown, path = ''): [string, string][] => {
    if (typeof value === 'string') return [[path, value]];
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) => stringsOf(child, path ? `${path}.${key}` : key));
  };

  it.each(codes)('the %s catalog advertises neither self-hosting nor open source', (language) => {
    const strings = stringsOf(JSON.parse(readFileSync(catalogFile(language), 'utf8')));
    expect(strings.filter(([, text]) => ADVERTISES_THE_LICENCE_OR_HOSTING.test(text))).toEqual([]);
  });

  it.each(codes)('the %s catalog does not name the licence at all', (language) => {
    const strings = stringsOf(JSON.parse(readFileSync(catalogFile(language), 'utf8')));
    expect(strings.filter(([, text]) => /AGPL/.test(text)).map(([path]) => path)).toEqual([]);
  });

  it('the description, link preview and noscript text of index.html do not either', () => {
    expect(readFileSync(join(webRoot, 'index.html'), 'utf8')).not.toMatch(ADVERTISES_THE_LICENCE_OR_HOSTING);
  });

  it('the installed app\'s manifest does not either', () => {
    const config = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8');
    const description = config.match(/description:\s*'([^']+)'/)?.[1];
    expect(description).toBeTruthy();
    expect(description).not.toMatch(ADVERTISES_THE_LICENCE_OR_HOSTING);
  });
});

describe('the footer\'s language picker', () => {
  // The same choice stands at the top and in the footer.
  const picker = () => screen.getAllByRole('combobox')[0]!;

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ registrationOpen: true, sourceCodeUrl: null }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.lang = 'en';
  });

  // Fails if the translated catalog is added after init: i18next then keeps
  // `resolvedLanguage` on English, so a German page offers English as what is
  // already chosen, and the browser fires nothing when it is picked.
  it('shows the language a fetched catalog put the page in', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    await initLandingI18n();
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1, name: de.hero.title })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('de');
    expect(i18next.resolvedLanguage).toBe('de');
    expect(picker()).toHaveValue('de');
  });

  it('shows English on an English page', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await initLandingI18n();
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1, name: en.hero.title })).toBeInTheDocument();
    expect(picker()).toHaveValue('en');
  });

  // A change of language mounts what it translates anew; a part nobody watched would stay at the
  // first frame of its arrival, an empty cell, for the rest of the visit.
  it('keeps watching every part that arrives, after the language has changed', async () => {
    const observed = new Set<Element>();
    class Watching {
      observe(target: Element) { observed.add(target); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Watching);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await initLandingI18n();
    const { container } = render(<LandingPage />);
    expect(container.querySelectorAll('[data-arrive]').length).toBeGreaterThan(20);
    fireEvent.change(picker(), { target: { value: 'de' } });
    await waitFor(() => expect(picker()).toHaveValue('de'));
    await waitFor(() => {
      for (const part of container.querySelectorAll('[data-arrive]')) expect(observed.has(part)).toBe(true);
    });
  });

  it.each([['de', 'en'], ['en', 'de']])('from %s, picking %s stores it and shows it where the page stands', async (from, to) => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, from);
    await initLandingI18n();
    render(<LandingPage />);
    fireEvent.change(picker(), { target: { value: to } });
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(to);
    await waitFor(() => expect(picker()).toHaveValue(to));
    expect(document.documentElement.lang).toBe(to);
    expect(reload).not.toHaveBeenCalled();
  });
});
