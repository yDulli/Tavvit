import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import changelog from '../locales/en/changelog.json';
import roadmap from '../locales/en/roadmap.json';
import help from '../locales/en/help.json';
import status from '../locales/en/status.json';
import { publicPageAt } from './entry';
import { PublicPage } from './PublicPages';

const here = dirname(fileURLToPath(import.meta.url));

describe('what a visitor downloads', () => {
  it('holds none of the app', () => {
    for (const file of readdirSync(here).filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))) {
      const source = readFileSync(join(here, file), 'utf8');
      const imports = [...source.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1] ?? '');
      for (const imported of imports) {
        expect(imported, `${file}: ${imported}`).not.toMatch(/stores\/|\/api\/|components\/|hooks\/|\.\.\/App|appBoot|i18n\/formatters$|i18n\/index$|\.\.\/i18n$/);
      }
    }
  });
});

describe('which address is which page', () => {
  it('knows the pages, with or without a slash at the end', () => {
    expect(publicPageAt('/status')).toBe('/status');
    expect(publicPageAt('/help/')).toBe('/help');
    expect(publicPageAt('/changelog')).toBe('/changelog');
  });

  it('leaves everything else to the app', () => {
    for (const path of ['/', '/channels/@me', '/status/more', '/helpful', '/developers/bots']) expect(publicPageAt(path), path).toBeNull();
  });
});

describe('the pages', () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: 'en',
      defaultNS: 'status',
      ns: ['status', 'help', 'changelog'],
      resources: { en: { status, help, changelog, roadmap } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });

  const answer = (body: unknown, ok = true) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body }));
  };

  beforeEach(() => {
    answer({ checkedAt: 1, services: { chat: 'ok', uploads: 'ok', voice: 'off', mail: 'ok' }, notes: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('status: says everything runs, and what is not set up', async () => {
    render(<PublicPage path="/status" />);
    expect(await screen.findByText('Everything is running.')).toBeTruthy();
    expect(screen.getByText('Voice and video')).toBeTruthy();
    expect(screen.getByText('Not set up here')).toBeTruthy();
  });

  it('status: says so when something is down', async () => {
    answer({ checkedAt: 1, services: { chat: 'ok', uploads: 'down', voice: 'off', mail: 'ok' }, notes: [] });
    render(<PublicPage path="/status" />);
    expect(await screen.findByText('Something is not running.')).toBeTruthy();
    expect(screen.getByText('Not running')).toBeTruthy();
  });

  it('status: says so when the server does not answer, rather than nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
    render(<PublicPage path="/status" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('does not answer');
  });

  it('status: shows what the operator said, as text', async () => {
    answer({ checkedAt: 1, services: { chat: 'ok', uploads: 'ok', voice: 'ok', mail: 'ok' }, notes: [{ id: '1', tone: 'warning', body: 'We are <b>on it</b>', createdAt: 1_800_000_000_000, endedAt: null }] });
    render(<PublicPage path="/status" />);
    expect(await screen.findByText('We are <b>on it</b>')).toBeTruthy();
    expect(screen.getByText(/^Since /)).toBeTruthy();
  });

  it('status: says plainly that it shares the server\'s fate', async () => {
    render(<PublicPage path="/status" />);
    await screen.findByText('Everything is running.');
    expect(screen.getByText(/same server/)).toBeTruthy();
  });

  it('help: shows every topic, and every question', () => {
    render(<PublicPage path="/help" />);
    for (const topic of Object.values(help.topics)) {
      expect(screen.getByRole('heading', { name: topic.title })).toBeTruthy();
      for (const item of Object.values(topic.items)) expect(screen.getByText(item.q)).toBeTruthy();
    }
  });

  it('changelog: shows every version, newest first', () => {
    render(<PublicPage path="/changelog" />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(Object.values(changelog.versions).map((entry) => entry.title));
    expect(Object.keys(changelog.versions)[0]).toBe('1.32.8');
  });

  it('roadmap: shows what comes, in its sections, and what was just finished', () => {
    render(<PublicPage path="/roadmap" />);
    for (const section of Object.values(roadmap.sections)) {
      expect(screen.getByRole('heading', { level: 2, name: section.title })).toBeTruthy();
      for (const item of Object.values(section.items)) expect(screen.getByRole('heading', { level: 3, name: item.title })).toBeTruthy();
    }
    expect(screen.getByText(Object.values(changelog.versions)[0]!.title)).toBeTruthy();
    expect(screen.getByRole('link', { name: roadmap.recent.all }).getAttribute('href')).toBe('/changelog');
  });

  it('marks the page you are on, and leads to the others as plain addresses', () => {
    render(<PublicPage path="/help" />);
    const current = screen.getAllByRole('link', { name: 'Help' }).find((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status');
    expect(screen.getByRole('link', { name: 'Legal notice' })).toHaveAttribute('href', '/imprint');
  });

  it('names the tab after the page', async () => {
    render(<PublicPage path="/changelog" />);
    await waitFor(() => expect(document.title).toBe("What's new"));
  });
});
