import type { VoiceOverlayOptions, VoiceOverlayPerson } from '@backspace/shared/src/voiceOverlay';
import { getAvatarGradient } from '../utils/gradients';
import './overlay.css';

/**
 * What a voice overlay shows (docs/systems/voice-overlay.md): everyone in the channel, or only
 * whoever speaks, each with their picture, a ring while they speak, a mark while muted or
 * deafened, and their name on a dark label so it reads over any stream. Drawn the same in the
 * overlay page and in the preview of its dialog; it uses nothing of the app but the tile colours.
 */
export function VoiceOverlayView({ people, speaking, options }: {
  people: readonly VoiceOverlayPerson[];
  speaking: ReadonlySet<string>;
  options: VoiceOverlayOptions;
}) {
  const shown = options.show === 'speaking' ? people.filter((person) => speaking.has(person.id)) : people;
  return (
    <ul className="voice-overlay" data-layout={options.layout}>
      {shown.map((person) => (
        <li key={person.id} className="voice-overlay-person" data-speaking={speaking.has(person.id) ? 'true' : undefined}>
          <OverlayPicture person={person} />
          {options.names && <span className="voice-overlay-name">{person.name}</span>}
        </li>
      ))}
    </ul>
  );
}

function OverlayPicture({ person }: { person: VoiceOverlayPerson }) {
  const tile = getAvatarGradient(person.tileKey, person.name, person.avatarColor);
  const address = person.avatar
    ? (person.avatar.startsWith('http') || person.avatar.startsWith('/') ? person.avatar : `/api/uploads/${person.avatar}`)
    : null;
  return (
    <span className="voice-overlay-picture">
      {address
        ? <img src={address} alt="" draggable={false} />
        : <span className="voice-overlay-initial" style={{ background: tile.gradient }}>{person.name.charAt(0).toUpperCase()}</span>}
      {(person.muted || person.deafened) && (
        <span className="voice-overlay-mark" aria-hidden="true">
          {person.deafened ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 14.5-7.1M21 12v6M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3ZM21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 3l18 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6M19 10v2a7 7 0 0 1-.6 2.8M5 10v2a7 7 0 0 0 12 5M12 19v3M3 3l18 18" />
            </svg>
          )}
        </span>
      )}
    </span>
  );
}
