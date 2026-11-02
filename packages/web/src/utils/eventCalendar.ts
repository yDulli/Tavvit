import type { SpaceEvent } from '@backspace/shared/src/events';
import { saveBlob } from './saveBlob';

const ONE_HOUR_MS = 3_600_000;
/** RFC 5545: a line is at most 75 octets, longer ones continue after a line break and a space. */
const LINE_OCTETS = 75;

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** A moment in UTC, so the calendar shows it in its reader's own zone. */
function stamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > LINE_OCTETS) {
      parts.push(current);
      current = ' ';
      octets = 1;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** The event as an iCalendar file. An event with no stated end lasts an hour in the calendar. */
export function eventCalendarText(event: SpaceEvent, place: string | null, host: string, now: number = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tavvit//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@${host}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt ?? event.startsAt + ONE_HOUR_MS)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(place ? [`LOCATION:${escapeText(place)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function saveEventToCalendar(event: SpaceEvent, place: string | null): void {
  const text = eventCalendarText(event, place, window.location.hostname || 'tavvit');
  const name = event.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
  saveBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }), `${name}.ics`);
}
