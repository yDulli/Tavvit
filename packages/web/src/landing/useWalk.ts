import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { RoomId } from './planData';

/**
 * The visitor on the stage's plan (Stage.tsx), walking: out of the room they are in through its door,
 * along the hall, and through the door of the room they chose, as a person would and never through a
 * wall. The way is measured on the plan as it is laid out (`offsetLeft`/`offsetTop`, which a transform
 * does not move), so it holds at every width, and taken again when the plan changes size. Each stretch
 * is one CSS transition at a walking pace; the stylesheet gives the walker a transition only where the
 * reader has not asked for less motion, and there the walker simply stands in the room chosen.
 */

/** Where the visitor is: outside the house, or in one of its rooms (the hall is the room `entrance`). */
export type Whereabouts = RoomId | 'outside';

/** Where a point of the way lies: in a room, in the hall (a doorway counts as the hall), or outside. */
type Zone = Whereabouts | 'hall';

interface Waypoint {
  x: number;
  y: number;
  zone: Zone;
}

/** Pixels of the plan a visitor walks in a millisecond, and the shortest stretch in time. */
const PACE = 0.55;
const SHORTEST_MS = 90;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function boxOf(element: HTMLElement): Box {
  return { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
}

/** The plan's rooms, doors and hall in the floor's own coordinates, or null while it is not laid out. */
function measure(floor: HTMLElement) {
  const hallElement = floor.querySelector<HTMLElement>('[data-room="entrance"]');
  if (!hallElement || hallElement.offsetWidth === 0) return null;
  const hall = boxOf(hallElement);
  const hallY = hall.top + hall.height / 2;
  const roomBox = (id: RoomId): Box | null => {
    const element = floor.querySelector<HTMLElement>(`[data-room="${id}"]`);
    return element ? boxOf(element) : null;
  };

  /**
   * Where a visitor stands in a room: clear of its name, which stands at the top of a room above the hall
   * and at the foot of one below it, and in the hall a little way in from the door.
   */
  const rest = (where: Whereabouts): Waypoint => {
    if (where === 'outside') return { x: hall.left - 16, y: hallY, zone: 'outside' };
    if (where === 'entrance') return { x: hall.left + hall.width * 0.42, y: hallY, zone: 'entrance' };
    const room = roomBox(where);
    if (!room) return { x: hall.left + hall.width / 2, y: hallY, zone: 'hall' };
    const below = room.top > hallY;
    return { x: room.left + room.width * 0.42, y: room.top + room.height * (below ? 0.4 : 0.62), zone: where };
  };

  /**
   * The doorway between a room and the hall. Where the plan draws no door (a phone's plan, whose rooms
   * that do not touch the hall open onto the room beside them), the room is entered where it faces the hall.
   */
  const doorway = (id: RoomId): Waypoint => {
    const element = floor.querySelector<HTMLElement>(`[data-room="${id}"]`);
    const room = roomBox(id);
    if (!element || !room) return rest('entrance');
    const door = element.querySelector<HTMLElement>('.lp-door');
    const below = room.top > hallY;
    const y = below ? room.top : room.top + room.height;
    if (!door || door.offsetParent === null) return { x: room.left + room.width / 2, y, zone: 'hall' };
    return { x: room.left + door.offsetLeft + door.offsetWidth / 2, y, zone: 'hall' };
  };

  const outerDoor: Waypoint = { x: hall.left + 4, y: hallY, zone: 'hall' };

  /** The way from where the visitor is to where they go: out through a door, along the hall, in through a door. */
  const way = (from: Zone, to: Whereabouts): Waypoint[] => {
    const points: Waypoint[] = [];
    if (from === 'outside') points.push(outerDoor);
    else if (from !== 'hall' && from !== 'entrance') {
      const out = doorway(from);
      points.push(out, { x: out.x, y: hallY, zone: 'hall' });
    }
    if (to === 'outside') points.push(outerDoor, rest('outside'));
    else if (to === 'entrance') points.push(rest('entrance'));
    else {
      const into = doorway(to);
      points.push({ x: into.x, y: hallY, zone: 'hall' }, into, rest(to));
    }
    return points;
  };

  return { rest, way };
}

function place(marker: HTMLElement, point: Waypoint, ms: number): void {
  marker.style.transitionDuration = `${Math.round(ms)}ms`;
  marker.style.transform = `translate(${point.x}px, ${point.y}px)`;
}

function wantsLessMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Keeps the visitor's mark where the visitor is, walking it to `to` whenever that changes; the ref it
 * returns goes on the mark, which stands at the floor's top left. The mark is hidden until it has been
 * placed once (`data-ready`), so a page rendered ahead of time never shows it in the wrong place.
 */
export function useWalk(floor: RefObject<HTMLElement | null>, to: Whereabouts): RefObject<HTMLSpanElement> {
  const marker = useRef<HTMLSpanElement>(null);
  // Where the walker stands, or the last point of the way it reached, and which walk is the current one.
  const standing = useRef<Waypoint | null>(null);
  const target = useRef<Whereabouts>(to);
  const walk = useRef(0);

  // Placed at once on the first layout, and again whenever the plan changes size.
  useLayoutEffect(() => {
    const floorElement = floor.current;
    const markerElement = marker.current;
    if (!floorElement || !markerElement) return undefined;
    const stand = () => {
      const plan = measure(floorElement);
      if (!plan) return;
      walk.current += 1;
      const point = plan.rest(target.current);
      place(markerElement, point, 0);
      standing.current = point;
      markerElement.dataset.ready = 'true';
    };
    stand();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(stand);
    observer?.observe(floorElement);
    return () => {
      observer?.disconnect();
      walk.current += 1;
    };
  }, [floor]);

  useEffect(() => {
    const floorElement = floor.current;
    const markerElement = marker.current;
    if (!floorElement || !markerElement || target.current === to) return undefined;
    target.current = to;
    const plan = measure(floorElement);
    const from = standing.current;
    if (!plan || !from) return undefined;
    const id = walk.current + 1;
    walk.current = id;
    if (wantsLessMotion()) {
      const point = plan.rest(to);
      place(markerElement, point, 0);
      standing.current = point;
      return undefined;
    }
    const points = plan.way(from.zone, to);
    let timer = 0;
    const next = (index: number, at: Waypoint) => {
      if (walk.current !== id) return;
      const point = points[index];
      if (!point) return;
      const ms = Math.max(SHORTEST_MS, Math.hypot(point.x - at.x, point.y - at.y) / PACE);
      place(markerElement, point, ms);
      timer = window.setTimeout(() => {
        standing.current = point;
        next(index + 1, point);
      }, ms);
    };
    next(0, from);
    return () => window.clearTimeout(timer);
  }, [floor, to]);

  return marker;
}
