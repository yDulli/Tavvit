import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import {
  voiceOverlayOptionsOf,
  voiceOverlaySecretOf,
  type VoiceOverlayState,
} from '@backspace/shared/src/voiceOverlay';
import { VoiceOverlayView } from './VoiceOverlayView';

/** How often the page asks who is in the channel; who speaks comes from LiveKit as it happens. */
const ASK_EVERY_MS = 3_000;
/** After an answer that the link no longer works, how long until it asks again (it may have been a moment's error). */
const ASK_AGAIN_GONE_MS = 30_000;

/** The one thing the page says in words, in the browser's language (the page loads no catalogs). */
const GONE: Record<string, string> = {
  en: 'This overlay link no longer works. Make a new one in Tavvit.',
  de: 'Dieser Overlay-Link funktioniert nicht mehr. Erstelle in Tavvit einen neuen.',
  pt: 'Este link de overlay não funciona mais. Crie um novo no Tavvit.',
  ru: 'Эта ссылка на оверлей больше не работает. Создайте новую в Tavvit.',
  zh: '此叠加层链接已失效。请在 Tavvit 中创建新的链接。',
};

function goneText(): string {
  const language = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return GONE[language] ?? GONE.en!;
}

/** LiveKit's identity of a person is `<id>:<name>` (routes/livekit.ts): the id is what the overlay knows them by. */
function personIdOf(identity: string): string {
  return identity.split(':')[0] ?? identity;
}

/**
 * The overlay page (docs/systems/voice-overlay.md): asks the server with the link's secret who is
 * in the channel every few seconds, and listens to LiveKit, as a participant nobody sees that can
 * neither hear nor send, for who is speaking. Nothing else is fetched and nothing is stored.
 */
export function VoiceOverlayPage() {
  const secret = voiceOverlaySecretOf(window.location.pathname);
  const [options] = useState(() => voiceOverlayOptionsOf(window.location.search));
  const [state, setState] = useState<VoiceOverlayState | null>(null);
  const [gone, setGone] = useState(false);
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  const roomRef = useRef<Room | null>(null);
  const connectingRef = useRef(false);

  useEffect(() => {
    if (!secret) return undefined;
    let live = true;
    let timer: number | undefined;
    const ask = async () => {
      let next = ASK_EVERY_MS;
      try {
        const response = await fetch(`/api/overlay/voice/${secret}`, { cache: 'no-store' });
        if (response.status === 404) {
          if (live) setGone(true);
          next = ASK_AGAIN_GONE_MS;
        } else if (response.ok) {
          const answer = await response.json() as VoiceOverlayState;
          if (live) {
            setGone(false);
            setState(answer);
          }
        }
      } catch {
        // A moment without the network: the next ask tries again.
      }
      if (live) timer = window.setTimeout(() => void ask(), next);
    };
    void ask();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [secret]);

  // Who speaks: one hidden LiveKit participant for as long as the page is open, joined with the
  // newest token whenever it is not connected.
  const livekit = state?.livekit ?? null;
  useEffect(() => {
    if (!livekit || roomRef.current || connectingRef.current) return;
    connectingRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { Room, RoomEvent } = await import('livekit-client');
        const room = new Room({ adaptiveStream: false, dynacast: false });
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeaking(new Set(speakers.map((participant) => personIdOf(participant.identity))));
        });
        room.on(RoomEvent.Disconnected, () => {
          if (roomRef.current === room) roomRef.current = null;
          setSpeaking(new Set());
        });
        await room.connect(livekit.url, livekit.token, { autoSubscribe: false });
        if (cancelled) {
          await room.disconnect();
          return;
        }
        roomRef.current = room;
      } catch {
        // No voice for now: the people still show, without who speaks; the next answer tries again.
      } finally {
        connectingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [livekit]);

  useEffect(() => () => {
    void roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  if (gone) return <p className="voice-overlay-problem">{goneText()}</p>;
  if (!state) return null;
  return <VoiceOverlayView people={state.people} speaking={speaking} options={options} />;
}
