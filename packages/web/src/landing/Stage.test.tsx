import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en/landing.json';
import { Stage } from './Stage';

// The stage is the opening the product page had until its look changed: Tavvit on one screen, with
// the list of channels drawn as a floor plan one can walk. The page no longer shows it
// (LandingPage.tsx), and the component is kept as it was. These tests hold it to what it did,
// rendered by itself, so it still works for whoever puts it somewhere again.

describe('the stage', () => {
  beforeAll(async () => {
    // jsdom lays nothing out, so there is nothing to measure when headings are fitted.
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    if (!i18next.isInitialized) {
      await i18next.use(initReactI18next).init({
        lng: 'en',
        defaultNS: 'landing',
        ns: ['landing'],
        resources: { en: { landing: en } },
        interpolation: { escapeValue: false },
      });
    }
  });

  beforeEach(() => {
    // Nothing the stage does may leave the page: any request at all would show here.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderStage = () => render(<Stage registrationOpen chat={null} version={null} />);

  /** A room on the stage, by the start of its button's name (its name, its kind, what goes on in it). */
  const roomButton = (name: string) => within(screen.getByRole('figure', { name: en.plan.label })).getByRole('button', { name: new RegExp(`^${name}, `) });

  describe('the channel to try', () => {
    /** Walks into #general, which shows the rules in place of the composer, and agrees to them. */
    const enter = () => {
      fireEvent.click(roomButton('general'));
      fireEvent.click(screen.getByRole('button', { name: en.stage.locked.agree }));
    };
    const composer = () => screen.getByRole('textbox', { name: en.demo.placeholder });
    const say = (text: string) => {
      fireEvent.change(composer(), { target: { value: text } });
      fireEvent.submit(composer().closest('form')!);
    };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('answers someone who writes, and sends nothing anywhere', async () => {
      renderStage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      enter();
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
      renderStage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      enter();
      for (let turn = 0; turn < 8; turn += 1) {
        say(`Message ${turn}`);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      }
      expect(screen.getAllByText(en.demo.replies.lena)).toHaveLength(1);
      expect(screen.getByText(en.demo.replies.end)).toBeInTheDocument();
    });

    it('shows what someone types as words, never as markup or a link', async () => {
      const { container } = renderStage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      enter();
      say('<img src=x onerror=alert(1)> https://example.org');
      expect(screen.getByText('<img src=x onerror=alert(1)> https://example.org')).toBeInTheDocument();
      expect(container.querySelector('.lp-demo-list img, .lp-demo-list a')).toBeNull();
    });

    it('takes no empty message, and offers a seat only after a first one', async () => {
      renderStage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      enter();
      const lines = document.querySelectorAll('.lp-demo-line').length;
      say('   ');
      expect(document.querySelectorAll('.lp-demo-line').length).toBe(lines);
      expect(screen.queryByRole('link', { name: en.demo.cta })).not.toBeInTheDocument();
      say('Hi');
      expect(screen.getByRole('link', { name: en.demo.cta })).toHaveAttribute('href', '/register');
    });

    it('lets a reaction be added and taken back', async () => {
      renderStage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      enter();
      const wave = screen.getByRole('button', { name: /👋/ });
      expect(wave).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(wave);
      expect(wave).toHaveAttribute('aria-pressed', 'true');
      expect(wave).toHaveTextContent('4');
      fireEvent.click(wave);
      expect(wave).toHaveTextContent('3');
    });
  });

  it('lets the visitor walk in, agree to the rules and drop into the lounge', async () => {
    renderStage();
    const plan = screen.getByRole('figure', { name: en.plan.label });
    expect(within(plan).getAllByRole('button')).toHaveLength(8);
    // Outside the door every room but the way in is shut, and the invite waits beside the plan.
    expect(roomButton('general')).toHaveAccessibleName(`general, ${en.plan.kinds.text}, ${en.plan.states.locked}`);
    fireEvent.click(screen.getByRole('button', { name: en.stage.invite.enter }));
    expect(screen.getByRole('heading', { level: 3, name: en.stage.welcome.title })).toBeInTheDocument();
    expect(roomButton(en.plan.kinds.entrance)).toHaveAttribute('aria-current', 'location');
    // In, but not yet agreed: the text rooms may be read and not written in, as the app holds a member back.
    expect(roomButton('general')).toHaveAccessibleName(`general, ${en.plan.kinds.text}, ${en.plan.states.readOnly}`);
    fireEvent.click(screen.getByRole('button', { name: en.stage.welcome.agree }));
    expect(screen.getByRole('status')).toHaveTextContent(en.stage.welcome.agreed);
    expect(roomButton('general')).toHaveAccessibleName(`general, ${en.plan.kinds.text}, ${en.plan.states.here} 3`);
    // The lounge: joining counts the visitor in, there and on the plan.
    fireEvent.click(roomButton('lounge'));
    fireEvent.click(screen.getByRole('button', { name: en.stage.voice.join }));
    expect(screen.getByText('3 in the room')).toBeInTheDocument();
    expect(roomButton('lounge')).toHaveAccessibleName(`lounge, ${en.plan.kinds.voice}, ${en.plan.states.talking} 3`);
    fireEvent.click(screen.getByRole('button', { name: en.stage.voice.mute }));
    expect(screen.getByRole('button', { name: en.stage.voice.unmute })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets every room be used for what it is for, and keeps a poll\'s results until one has voted', async () => {
    renderStage();
    fireEvent.click(screen.getByRole('button', { name: en.stage.invite.enter }));
    fireEvent.click(screen.getByRole('button', { name: en.stage.welcome.agree }));
    // raid-planning's thread opens over the channel, with its replies.
    fireEvent.click(roomButton('raid-planning'));
    fireEvent.click(screen.getByRole('button', { name: /^Fight notes/ }));
    expect(screen.getByText(en.stage.thread.r7)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.stage.thread.follow }));
    expect(screen.getByRole('button', { name: en.stage.thread.following })).toHaveAttribute('aria-pressed', 'true');
    // clips: a spoiler stays veiled until it is lifted.
    fireEvent.click(roomButton('clips'));
    fireEvent.click(screen.getByRole('button', { name: en.stage.clips.spoiler }));
    expect(screen.queryByRole('button', { name: en.stage.clips.spoiler })).not.toBeInTheDocument();
    // patch-notes: no share before the visitor's vote, every share after it.
    fireEvent.click(roomButton('patch-notes'));
    expect(screen.getByText(en.stage.poll.hidden)).toBeInTheDocument();
    expect(screen.queryByText('4 votes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.stage.poll.skill }));
    expect(screen.getByText('5 votes')).toBeInTheDocument();
    expect(screen.getByText('8 people voted')).toBeInTheDocument();
    // movie night: watching along counts the visitor in.
    fireEvent.click(roomButton('movie-night'));
    fireEvent.click(screen.getByRole('button', { name: en.stage.watch.join }));
    expect(roomButton('movie-night')).toHaveAccessibleName(`movie-night, ${en.plan.kinds.voice}, ${en.plan.states.watching} 2`);
    // The events: going counts the visitor in, and the event leads on to the lounge.
    fireEvent.click(roomButton(en.plan.kinds.events));
    fireEvent.click(screen.getByRole('button', { name: en.stage.event.rsvp }));
    expect(screen.getByText('7 going')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.stage.event.lounge }));
    expect(roomButton('lounge')).toHaveAttribute('aria-current', 'location');
  });

  it('shows from the member list who is where, and lays a look on the window', async () => {
    const { container } = renderStage();
    fireEvent.click(screen.getByRole('button', { name: '8 people' }));
    expect(screen.getByText('Raid Lead — 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Lena Hoffmann/ }));
    expect(container.querySelector('[data-room="raid"]')).toHaveAttribute('data-lit', 'true');
    expect(container.querySelector('[data-room="raid"] [data-found="true"]')).toHaveTextContent('L');
    fireEvent.click(screen.getByRole('button', { name: en.stage.looks }));
    fireEvent.click(screen.getByRole('radio', { name: en.themes.names.clay }));
    expect((container.querySelector('.lp-app') as HTMLElement).style.getPropertyValue('--accent-primary')).toBe('224 80 31');
  });
});
