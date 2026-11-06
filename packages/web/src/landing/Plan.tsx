import React from 'react';
import { useTranslation } from 'react-i18next';
import { Glyph, type CssVars, type GlyphName } from './parts';
import { PEOPLE, PLAN_ROOMS, PLAN_SPACE, type PersonId, type PlanRoom, type RoomId, type RoomKind, type RoomState } from './planData';

/**
 * A space drawn as a floor plan, the product page's own picture of what Tavvit is (docs/systems/landing.md,
 * "The plan"): a space is a place, its channels are rooms in the wings of its categories, its way in is
 * the hall every room opens onto, and the people in it stand in the rooms they are in. It is drawn in the
 * app's material: graphite floors, hairline walls, and light falling into a room from above in that
 * room's colour, as the app lights the place you are in.
 *
 * It stands on the opening's stage (Stage.tsx) where the app has its list of channels, and can be walked
 * through: each room is a button, and choosing one walks the visitor there (the stage draws them,
 * `overlay`) and opens it beside the plan. What the visitor may do shows on it (`locked`, `readOnly`),
 * what is going on in a room is said in it (`says`), and someone looked for in the member list is ringed
 * (`found`).
 */

export const KIND_GLYPHS: Record<RoomKind, GlyphName> = {
  text: 'hash',
  voice: 'speaker',
  events: 'calendar',
  entrance: 'enter',
};

/** What a room says of itself, when the stage knows better than the plan's data (someone has come in). */
export interface RoomSays {
  state: RoomState;
  count?: number;
}

export interface PlanProps {
  /** Rooms in light: where the visitor is, or where someone looked for is. */
  lit: ReadonlySet<RoomId>;
  /** Rooms the visitor cannot enter: hatched, as a plan marks a place without access. */
  locked?: ReadonlySet<RoomId>;
  /** Rooms the visitor may read and not write in. */
  readOnly?: ReadonlySet<RoomId>;
  /** Someone looked for in the member list, whose mark is ringed. */
  found?: PersonId | null;
  /** What a room says in place of its data's state; null, that it says nothing (a room no longer new). */
  says?: Partial<Record<RoomId, RoomSays | null>>;
  /** Choosing a room calls `onActivate`; `current` is where the visitor is. */
  interactive: { onActivate: (room: RoomId) => void; current: RoomId | null };
  /** Drawn on the floor over the rooms, in its coordinates (the visitor walking). */
  overlay?: React.ReactNode;
  floorRef?: React.Ref<HTMLDivElement>;
}

/** A room's name as the app shows it: the channel's own, or for a part of the space the name of its kind. */
export function roomName(room: PlanRoom, kind: string): string {
  return room.name ?? kind;
}

export function Plan({ lit, locked, readOnly, found = null, says, interactive, overlay, floorRef }: PlanProps): React.JSX.Element {
  const { t } = useTranslation('landing');

  const stateOf = (room: PlanRoom): { label: string; state: RoomState | null } | null => {
    if (locked?.has(room.id)) return { label: t('plan.states.locked'), state: null };
    if (readOnly?.has(room.id)) return { label: t('plan.states.readOnly'), state: null };
    const own = room.state ? { state: room.state, count: room.count } : null;
    const said = says && room.id in says ? says[room.id] ?? null : own;
    if (!said) return null;
    const label = t(`plan.states.${said.state}`);
    return { label: said.count === undefined ? label : `${label} ${said.count}`, state: said.state };
  };

  const rooms = PLAN_ROOMS.map((room) => {
    const kind = t(`plan.kinds.${room.kind}`);
    const state = stateOf(room);
    const isLocked = locked?.has(room.id) ?? false;
    const isReadOnly = !isLocked && (readOnly?.has(room.id) ?? false);
    const content = (
      <>
        <span className="lp-room-light" aria-hidden="true" />
        <span className="lp-room-name">
          <Glyph name={KIND_GLYPHS[room.kind]} />
          <span>{roomName(room, kind)}</span>
          {state?.state === 'unread' && <i className="lp-room-unread" aria-hidden="true" />}
        </span>
        <span className="lp-room-meta">
          {/* A part of the space is already named by its kind. */}
          {room.name !== null && <span className="lp-room-kind">{kind}</span>}
          {state && (
            <span className="lp-room-state" data-state={isLocked ? 'locked' : isReadOnly ? 'read' : state.state ?? undefined}>
              {isLocked && <Glyph name="lock" />}
              {isReadOnly && <Glyph name="eye" />}
              {state.state === 'watching' && <Glyph name="play" />}
              {state.label}
            </span>
          )}
        </span>
        {room.kind === 'entrance' && <span className="lp-room-address lp-mono">{PLAN_SPACE.invite}</span>}
        {room.people.length > 0 && (
          <span className="lp-room-people" aria-hidden="true">
            {room.people.map((person) => (
              <i key={person} style={{ '--who': PEOPLE[person].color } as CssVars} data-speaking={room.speaking === person ? 'true' : undefined} data-found={found === person ? 'true' : undefined}>{PEOPLE[person].initial}</i>
            ))}
          </span>
        )}
        {room.id === 'raid' && (
          <span className="lp-room-alcove">
            <Glyph name="thread" />
            <span className="lp-room-alcove-name">{PLAN_SPACE.thread.name}</span>
            <span className="lp-room-alcove-count lp-mono">{t('plan.states.replies')} {PLAN_SPACE.thread.replies}</span>
          </span>
        )}
        <span className="lp-door" aria-hidden="true" />
      </>
    );
    const shared = {
      className: 'lp-room',
      'data-room': room.id,
      'data-door': room.door,
      'data-lit': lit.has(room.id) ? 'true' : undefined,
      'data-locked': isLocked ? 'true' : undefined,
      style: { '--room': room.place } as CssVars,
    };
    // Its name, its kind and what is going on in it, as a list: the marks on the floor are a picture.
    const label = [roomName(room, kind), room.name === null ? null : kind, state?.label].filter(Boolean).join(', ');
    return (
      <button
        key={room.id}
        type="button"
        {...shared}
        aria-label={label}
        aria-current={interactive.current === room.id ? 'location' : undefined}
        onClick={() => interactive.onActivate(room.id)}
      >
        {content}
      </button>
    );
  });

  return (
    <figure className="lp-plan" aria-label={t('plan.label')}>
      {/* The wings over the plan, measured as a drawing measures: a line between two ticks, its name on it. */}
      <div className="lp-plan-wings" aria-hidden="true">
        <span className="lp-plan-wing"><span className="lp-label">{PLAN_SPACE.wings.hangout}</span></span>
        <span className="lp-plan-wing"><span className="lp-label">{PLAN_SPACE.wings.games}</span></span>
      </div>
      <div className="lp-plan-floor" ref={floorRef}>{rooms}{overlay}</div>
    </figure>
  );
}
