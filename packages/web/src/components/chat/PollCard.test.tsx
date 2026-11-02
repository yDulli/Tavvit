import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageWithUser } from '@backspace/shared';
import type { PollInfo } from '@backspace/shared/src/polls';
import { PollCard } from './PollCard';

const client = vi.hoisted(() => ({
  messages: { votePoll: vi.fn(), endPoll: vi.fn(), pollVoters: vi.fn() },
}));
const applyPoll = vi.hoisted(() => vi.fn());

vi.mock('../../stores/spaceStore', () => ({
  getApiForOrigin: () => client,
  getChannelOrigin: () => '',
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ applyPoll }) },
}));

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));

function poll(extra: Partial<PollInfo> = {}): PollInfo {
  return {
    multiple: false,
    endsAt: null,
    endedAt: null,
    voters: 0,
    myVotes: [],
    options: [{ id: 'a', label: 'Pizza', votes: 0 }, { id: 'b', label: 'Pasta', votes: 0 }],
    ...extra,
  };
}

const message = (info: PollInfo) => ({ id: 'm1', channelId: 'c1', content: 'Pizza or pasta?', poll: info }) as unknown as MessageWithUser;

beforeEach(() => {
  vi.clearAllMocks();
  client.messages.votePoll.mockResolvedValue(poll({ myVotes: ['a'] }));
});

describe('a poll in the timeline', () => {
  it('keeps the count hidden from someone who has not voted, and says votes are open to all', () => {
    render(<PollCard message={message(poll({ voters: 3, options: [{ id: 'a', label: 'Pizza', votes: 2 }, { id: 'b', label: 'Pasta', votes: 1 }] }))} canEnd={false} />);
    expect(screen.queryByText('67%')).toBeNull();
    expect(screen.getByText('3 people voted')).toBeTruthy();
    expect(screen.getByText('Everyone in this channel can see who chose what.')).toBeTruthy();
  });

  it('shows it once they have', () => {
    render(<PollCard message={message(poll({ voters: 3, myVotes: ['a'], options: [{ id: 'a', label: 'Pizza', votes: 2 }, { id: 'b', label: 'Pasta', votes: 1 }] }))} canEnd={false} />);
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pizza/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('sends one answer for a single choice, in place of the one before', async () => {
    render(<PollCard message={message(poll({ myVotes: ['a'], voters: 1 }))} canEnd={false} />);
    await userEvent.click(screen.getByRole('button', { name: /Pasta/ }));
    expect(client.messages.votePoll).toHaveBeenCalledWith('m1', ['b']);
    await waitFor(() => expect(applyPoll).toHaveBeenCalled());
  });

  it('takes a vote back when the same answer is chosen again', async () => {
    render(<PollCard message={message(poll({ myVotes: ['a'], voters: 1 }))} canEnd={false} />);
    await userEvent.click(screen.getByRole('button', { name: /Pizza/ }));
    expect(client.messages.votePoll).toHaveBeenCalledWith('m1', []);
  });

  it('adds to the answers on a multiple choice', async () => {
    render(<PollCard message={message(poll({ multiple: true, myVotes: ['a'], voters: 1 }))} canEnd={false} />);
    await userEvent.click(screen.getByRole('button', { name: /Pasta/ }));
    expect(client.messages.votePoll).toHaveBeenCalledWith('m1', ['a', 'b']);
  });

  it('takes nothing once it is over, and shows the result to everyone', () => {
    render(<PollCard message={message(poll({ endedAt: 5, voters: 2, options: [{ id: 'a', label: 'Pizza', votes: 2 }, { id: 'b', label: 'Pasta', votes: 0 }] }))} canEnd />);
    expect(screen.getByText('100%')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Pizza/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'End poll' })).toBeNull();
    expect(screen.getByText(/Ended/)).toBeTruthy();
  });

  it('offers the end to whoever may, and asks first', async () => {
    client.messages.endPoll.mockResolvedValue(poll({ endedAt: 9 }));
    render(<PollCard message={message(poll())} canEnd />);
    await userEvent.click(screen.getByRole('button', { name: 'End poll' }));
    expect(client.messages.endPoll).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'End poll' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(client.messages.endPoll).toHaveBeenCalledWith('m1'));
  });

  it('offers no end to anyone else', () => {
    render(<PollCard message={message(poll())} canEnd={false} />);
    expect(screen.queryByRole('button', { name: 'End poll' })).toBeNull();
  });
});
