import { describe, expect, it, vi } from 'vitest';
import { fileTitleOf, parseWatchUrl, watchPositionAt } from '@backspace/shared/src/watch.js';
import { setWorkerId } from './snowflake.js';

// What a pasted link plays, and where a session's video stands on the server's clock
// (docs/systems/watch-together.md).

setWorkerId(34);

vi.mock('../ws/handler.js', () => ({
  connectionManager: { sendToUsers: vi.fn(), sendToChannel: vi.fn() },
  watchPresenceOf: () => null,
}));

const { addToSession, announceWatch, announceWatchPosition, applyWatchAction, endSession, mayControl } = await import('./watchSessions.js');

describe('what a link plays', () => {
  it('reads every form of a YouTube link, with where it starts', () => {
    const id = 'dQw4w9WgXcQ';
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&list=PL1`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
    ]) {
      expect(parseWatchUrl(link), link).toEqual({ provider: 'youtube', ref: id, startMs: 0, url: `https://www.youtube.com/watch?v=${id}` });
    }
    expect(parseWatchUrl(`https://youtu.be/${id}?t=90`)?.startMs).toBe(90_000);
    expect(parseWatchUrl(`https://www.youtube.com/watch?v=${id}&t=1m30s`)?.startMs).toBe(90_000);
    expect(parseWatchUrl(`https://www.youtube.com/watch?v=${id}&t=1h`)?.startMs).toBe(3_600_000);
    expect(parseWatchUrl(`https://www.youtube.com/watch?v=${id}&t=nonsense`)?.startMs).toBe(0);
  });

  it('reads a Vimeo link, with the key of an unlisted one', () => {
    expect(parseWatchUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', ref: '76979871', startMs: 0, url: 'https://vimeo.com/76979871' });
    expect(parseWatchUrl('https://vimeo.com/76979871/aB12cd34EF')?.ref).toBe('76979871:ab12cd34ef');
    expect(parseWatchUrl('https://player.vimeo.com/video/76979871?h=ab12cd34ef')?.url).toBe('https://vimeo.com/76979871/ab12cd34ef');
    expect(parseWatchUrl('https://vimeo.com/76979871#t=30s')?.startMs).toBe(30_000);
  });

  it('takes a video file only over https', () => {
    expect(parseWatchUrl('https://files.example/films/Night%20Sky.mp4#t=5')).toEqual({
      provider: 'file', ref: 'https://files.example/films/Night%20Sky.mp4', startMs: 5_000, url: 'https://files.example/films/Night%20Sky.mp4',
    });
    expect(parseWatchUrl('http://files.example/film.mp4')).toBeNull();
    expect(fileTitleOf('https://files.example/films/Night%20Sky.mp4')).toBe('Night Sky');
    // Never the address: a query may hold what only the call should see.
    expect(fileTitleOf('https://files.example/clip.mp4?token=secret')).toBe('clip');
    expect(fileTitleOf('https://files.example/a%ZZ.mp4')).toBe('a%ZZ');
    expect(fileTitleOf('https://files.example/')).toBe('files.example');
  });

  it('refuses everything else', () => {
    for (const link of [
      '', 'not a link', 'javascript:alert(1)', 'data:video/mp4;base64,AAAA', 'ftp://example.com/a.mp4',
      'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/channel/UC123', 'https://youtu.be/a/b',
      'https://vimeo.com/channels/staffpicks', 'https://vimeo.com/123/not-a-key!', 'https://example.com/page',
      `https://example.com/${'a'.repeat(3000)}.mp4`,
      // Short as pasted, long as kept: the parser writes each of these characters as nine.
      `https://example.com/${'中'.repeat(700)}.mp4`,
    ]) {
      expect(parseWatchUrl(link), link).toBeNull();
    }
    expect(parseWatchUrl(42)).toBeNull();
  });
});

describe('where the video stands', () => {
  it('runs on while it plays and holds while it is paused', () => {
    expect(watchPositionAt({ playing: true, positionMs: 10_000, stateAt: 1_000 }, 4_000)).toBe(13_000);
    expect(watchPositionAt({ playing: false, positionMs: 10_000, stateAt: 1_000 }, 4_000)).toBe(10_000);
    // A clock behind the stamp does not move it back.
    expect(watchPositionAt({ playing: true, positionMs: 10_000, stateAt: 5_000 }, 4_000)).toBe(10_000);
  });
});

function makeRoom() {
  return {
    roomId: 'voice-1',
    roomType: 'space' as const,
    participants: new Set(['alice', 'bob']),
    metadata: { type: 'space' as const, spaceId: 'space-1' },
    startedAt: 0,
  } as Parameters<typeof addToSession>[0];
}

const youtube = parseWatchUrl('https://youtu.be/dQw4w9WgXcQ?t=5')!;
const vimeo = parseWatchUrl('https://vimeo.com/76979871')!;

describe('a session', () => {
  it('starts with the first video at where its link starts, and queues the rest', () => {
    const room = makeRoom();
    expect(addToSession(room, youtube, 'One', 'alice', 1_000).kind).toBe('started');
    expect(room.watch).toMatchObject({ playing: true, positionMs: 5_000, stateAt: 1_000, control: 'everyone', starterId: 'alice' });
    expect(addToSession(room, vimeo, 'Two', 'bob', 2_000).kind).toBe('queued');
    expect(room.watch?.queue.map((item) => item.title)).toEqual(['Two']);
  });

  it('pausing keeps where it stood, playing runs on from there', () => {
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    applyWatchAction(room, { action: 'pause' }, 'bob', 4_000);
    expect(room.watch).toMatchObject({ playing: false, positionMs: 8_000, stateAt: 4_000 });
    // A second pause changes nothing.
    applyWatchAction(room, { action: 'pause' }, 'bob', 9_000);
    expect(room.watch).toMatchObject({ positionMs: 8_000, stateAt: 4_000 });
    applyWatchAction(room, { action: 'play' }, 'alice', 10_000);
    expect(room.watch).toMatchObject({ playing: true, positionMs: 8_000, stateAt: 10_000 });
  });

  it('a seek lands where it says, within a day', () => {
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    applyWatchAction(room, { action: 'seek', positionMs: 99_999_999_999 }, 'bob', 2_000);
    expect(room.watch?.positionMs).toBe(24 * 60 * 60 * 1000);
  });

  it('next plays the queue in order, then stops; removing the video that plays skips to the next', () => {
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    addToSession(room, vimeo, 'Two', 'bob', 1_000);
    addToSession(room, vimeo, 'Three', 'bob', 1_000);
    applyWatchAction(room, { action: 'remove', itemId: room.watch!.current!.id }, 'bob', 2_000);
    expect(room.watch?.current?.title).toBe('Two');
    applyWatchAction(room, { action: 'next' }, 'bob', 3_000);
    expect(room.watch?.current?.title).toBe('Three');
    applyWatchAction(room, { action: 'next' }, 'bob', 4_000);
    expect(room.watch).toMatchObject({ current: null, playing: false });
    // A link added to a session that ran dry plays at once.
    expect(addToSession(room, youtube, 'Four', 'bob', 5_000).kind).toBe('started');
    expect(room.watch?.current?.title).toBe('Four');
  });

  it('says when a change changed nothing, and what a change reached', () => {
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    expect(applyWatchAction(room, { action: 'play' }, 'bob', 2_000)).toMatchObject({ kind: 'unchanged' });
    expect(applyWatchAction(room, { action: 'pause' }, 'bob', 2_000)).toMatchObject({ kind: 'changed', scope: 'position' });
    expect(applyWatchAction(room, { action: 'seek', positionMs: room.watch!.positionMs }, 'bob', 3_000)).toMatchObject({ kind: 'unchanged' });
    expect(applyWatchAction(room, { action: 'next', itemId: 'gone' }, 'bob', 3_000)).toMatchObject({ kind: 'unchanged' });
    expect(applyWatchAction(room, { action: 'remove', itemId: 'gone' }, 'bob', 3_000)).toMatchObject({ kind: 'unchanged' });
    expect(applyWatchAction(room, { action: 'control', control: 'everyone' }, 'alice', 3_000)).toMatchObject({ kind: 'unchanged' });
    expect(applyWatchAction(room, { action: 'control', control: 'starter' }, 'alice', 3_000)).toMatchObject({ kind: 'changed', scope: 'session' });
    expect(applyWatchAction(room, { action: 'next' }, 'alice', 4_000)).toMatchObject({ kind: 'changed', scope: 'session' });
  });

  it('holds no more than it may send', () => {
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    const long = parseWatchUrl(`https://files.example/${'a'.repeat(1900)}.mp4`)!;
    let outcome: ReturnType<typeof addToSession> = { kind: 'queue_full' };
    for (let i = 0; i < 50; i += 1) {
      outcome = addToSession(room, long, 'Long', 'bob', 1_000);
      if (outcome.kind === 'queue_full') break;
    }
    expect(outcome.kind).toBe('queue_full');
    expect(JSON.stringify(room.watch).length).toBeLessThanOrEqual(64 * 1024);
    expect(room.watch!.queue.length).toBeGreaterThan(5);
  });

  it('only its starter may keep the controls, and an ended session is gone', () => {
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    expect(mayControl(room.watch!, 'bob')).toBe(true);
    expect(applyWatchAction(room, { action: 'control', control: 'starter' }, 'bob').kind).toBe('not_controller');
    applyWatchAction(room, { action: 'control', control: 'starter' }, 'alice');
    expect(mayControl(room.watch!, 'bob')).toBe(false);
    expect(applyWatchAction(room, { action: 'seek', positionMs: 1 }, 'bob').kind).toBe('not_controller');
    expect(endSession(room)).toBe(true);
    expect(endSession(room)).toBe(false);
    expect(applyWatchAction(room, { action: 'play' }, 'alice').kind).toBe('not_found');
  });
});

describe('what the call and the channel list are told', () => {
  it('the channel list only when what plays changed; a position alone for a play, pause or seek', async () => {
    const { connectionManager } = await import('../ws/handler.js');
    const room = makeRoom();
    addToSession(room, youtube, 'One', 'alice', 1_000);
    vi.mocked(connectionManager.sendToChannel).mockClear();
    announceWatch(room, 2_000, null);
    expect(connectionManager.sendToChannel).not.toHaveBeenCalled();
    announceWatch(room, 2_000, { title: 'Other', provider: 'vimeo' });
    expect(connectionManager.sendToChannel).toHaveBeenCalledTimes(1);
    announceWatch(room, 2_000);
    expect(connectionManager.sendToChannel).toHaveBeenCalledTimes(2);
    announceWatchPosition(room, 3_000);
    expect(vi.mocked(connectionManager.sendToUsers).mock.calls.at(-1)?.[1]).toMatchObject({
      type: 'watch_position', channelId: 'voice-1', position: { itemId: room.watch!.current!.id, playing: true, positionMs: 5_000 }, serverNow: 3_000,
    });
  });
});
