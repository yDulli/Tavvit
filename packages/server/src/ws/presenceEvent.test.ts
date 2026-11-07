import { describe, it, expect } from 'vitest';
import { validateActivities } from './presenceEvent.js';

// One rule for a local client's activity_update and a peer's relayed
// presence: an activity the sender accepts must be one every receiver accepts.
describe('validateActivities', () => {
  it('accepts a named activity and trims its name', () => {
    expect(validateActivities([{ type: 'playing', name: '  Factorio ' }])).toEqual([{ type: 'playing', name: 'Factorio' }]);
  });

  it('refuses a name that is only whitespace', () => {
    expect(validateActivities([{ type: 'playing', name: '   ' }])).toBeNull();
  });

  it('refuses an empty name', () => {
    expect(validateActivities([{ type: 'playing', name: '' }])).toBeNull();
  });
});

// Live on Twitch (docs/systems/activity-presence.md): only a person's home marks
// an activity as found on Twitch, so a client's mark is dropped and a peer's kept.
describe('validateActivities and the source mark', () => {
  const live = { type: 'streaming', name: 'Speedruns', url: 'https://www.twitch.tv/mara', source: 'twitch' };

  it('drops the mark from what a client sends', () => {
    expect(validateActivities([live])).toEqual([{ type: 'streaming', name: 'Speedruns', url: 'https://www.twitch.tv/mara' }]);
  });

  it('keeps the mark from a peer relaying its own person', () => {
    expect(validateActivities([live], { allowSource: true })).toEqual([live]);
  });

  it('drops a mark it does not know, even from a peer', () => {
    expect(validateActivities([{ ...live, source: 'youtube' }], { allowSource: true })).toEqual([{ type: 'streaming', name: 'Speedruns', url: 'https://www.twitch.tv/mara' }]);
  });
});
