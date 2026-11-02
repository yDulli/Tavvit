import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChannelCommand } from '@backspace/shared/src/bots';

const space = vi.hoisted(() => ({
  state: {
    currentSpaceId: 'space',
    members: [
      { userId: 'u2', nickname: null, user: { displayName: 'Zed', username: 'zed' } },
      { userId: 'u1', nickname: 'Ann', user: { displayName: 'Other', username: 'ann' } },
    ],
    channels: [{ id: 'c1', name: 'general' }],
    roles: [{ id: 'space', name: '@everyone' }, { id: 'r1', name: 'Regular' }],
  },
}));
vi.mock('../../stores/spaceStore', () => ({
  useSpaceStore: (select: (state: typeof space.state) => unknown) => select(space.state),
}));

import { CommandOptionsForm, commandValues } from './CommandOptionsForm';

const command = (options: ChannelCommand['options']): ChannelCommand => ({ botId: 'bot', botName: 'Roller', name: 'roll', description: 'Roll', options });

afterEach(cleanup);

describe('commandValues', () => {
  const options = [
    { name: 'count', description: 'd', type: 'number' as const },
    { name: 'loud', description: 'd', type: 'boolean' as const },
    { name: 'word', description: 'd', type: 'text' as const },
  ];

  it('gives a number as a number and a switch as a switch', () => {
    expect(commandValues(options, { count: '3', loud: true, word: 'hi' })).toEqual({ count: 3, loud: true, word: 'hi' });
  });

  it('leaves out what stayed empty', () => {
    expect(commandValues(options, { count: '', word: '' })).toEqual({});
  });
});

describe('CommandOptionsForm', () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  beforeEach(() => {
    onSubmit.mockReset();
    onCancel.mockReset();
  });
  const show = (options: ChannelCommand['options']) => render(<CommandOptionsForm command={command(options)} busy={false} onSubmit={onSubmit} onCancel={onCancel} />);
  const send = () => screen.getByRole('button', { name: 'Send' });

  it('names the command and its bot', () => {
    show([{ name: 'word', description: 'A word', type: 'text' }]);
    expect(screen.getByText('/roll')).toBeInTheDocument();
    expect(screen.getByText('Roller')).toBeInTheDocument();
    expect(screen.getByText('A word')).toBeInTheDocument();
  });

  it('cannot be sent until what is required is there', () => {
    show([{ name: 'word', description: 'A word', type: 'text', required: true }]);
    expect(send()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/word/), { target: { value: 'hi' } });
    expect(send()).toBeEnabled();
    fireEvent.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ word: 'hi' });
  });

  it('offers the choices it has, and nothing else', () => {
    show([{ name: 'colour', description: 'd', type: 'text', choices: ['red', 'blue'] }]);
    const picker = screen.getByLabelText(/colour/);
    fireEvent.change(picker, { target: { value: 'blue' } });
    fireEvent.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ colour: 'blue' });
  });

  it('offers the space\'s people by name, sorted, and hands on their ids', () => {
    show([{ name: 'who', description: 'd', type: 'person' }]);
    const picker = screen.getByLabelText(/who/) as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.textContent)).toEqual(['Choose', 'Ann', 'Zed']);
    fireEvent.change(picker, { target: { value: 'u2' } });
    fireEvent.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ who: 'u2' });
  });

  it('offers channels and roles, without the role of everyone', () => {
    show([{ name: 'where', description: 'd', type: 'channel' }, { name: 'as', description: 'd', type: 'role' }]);
    expect(Array.from((screen.getByLabelText(/where/) as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['Choose', '#general']);
    expect(Array.from((screen.getByLabelText(/^as/) as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['Choose', 'Regular']);
  });

  it('takes a switch and a number', () => {
    show([{ name: 'loud', description: 'd', type: 'boolean' }, { name: 'count', description: 'd', type: 'number' }]);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/count/), { target: { value: '4' } });
    fireEvent.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ loud: true, count: 4 });
  });

  it('is left with Escape or the button', () => {
    show([{ name: 'word', description: 'd', type: 'text' }]);
    fireEvent.keyDown(screen.getByLabelText(/word/), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
