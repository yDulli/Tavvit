import { describe, expect, it } from 'vitest';
import type { SpaceEvent } from '@backspace/shared/src/events';
import { eventCalendarText } from './eventCalendar';

const base: SpaceEvent = {
  id: 'e1',
  spaceId: 's1',
  title: 'Game night',
  description: null,
  location: null,
  channelId: null,
  startsAt: Date.UTC(2026, 10, 7, 18, 30),
  endsAt: null,
  createdBy: null,
  createdAt: 1,
  going: 0,
};

const NOW = Date.UTC(2026, 9, 31, 12);
const lines = (text: string) => text.split('\r\n');
/** Undoes folding: a line break and a space continue the line before. */
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('eventCalendarText', () => {
  it('states the moments in UTC, and an hour when no end is known', () => {
    const text = eventCalendarText(base, null, 'tavvit.com', NOW);
    expect(lines(text)).toEqual(expect.arrayContaining([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'UID:e1@tavvit.com',
      'DTSTAMP:20261031T120000Z',
      'DTSTART:20261107T183000Z',
      'DTEND:20261107T193000Z',
      'SUMMARY:Game night',
      'END:VCALENDAR',
    ]));
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text).not.toContain('DESCRIPTION:');
    expect(text).not.toContain('LOCATION:');
  });

  it('uses the stated end and escapes what iCalendar reserves', () => {
    const text = eventCalendarText({
      ...base,
      title: 'Plans; maybe, later\\now',
      description: 'First line\nsecond line',
      endsAt: Date.UTC(2026, 10, 7, 21),
    }, 'The attic, top floor', 'tavvit.com', NOW);
    expect(lines(text)).toEqual(expect.arrayContaining([
      'DTEND:20261107T210000Z',
      'SUMMARY:Plans\\; maybe\\, later\\\\now',
      'DESCRIPTION:First line\\nsecond line',
      'LOCATION:The attic\\, top floor',
    ]));
  });

  it('keeps no line over 75 octets, without splitting a character', () => {
    const title = '活动'.repeat(60);
    const text = eventCalendarText({ ...base, title }, null, 'tavvit.com', NOW);
    const encoder = new TextEncoder();
    for (const line of lines(text)) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`SUMMARY:${title}`);
  });
});
