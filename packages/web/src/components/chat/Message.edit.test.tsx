import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MessageWithUser, User } from '@backspace/shared';
import { initI18n } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { Message } from './Message';

vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const me = {
  id: 'me', username: 'alice', displayName: 'Alice', avatar: null, banner: null, accentColor: null, avatarColor: null,
  bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1, homeInstance: null, homeUserId: null,
  replicatedInstances: [],
} as User;

const message = {
  id: 'm1', channelId: 'c1', userId: me.id, replyToId: null, content: 'Hello there', editedAt: null,
  createdAt: 1, user: me, attachments: [], embeds: [], reactions: [],
} as MessageWithUser;

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  useChatStore.setState({ editingMessageId: null });
});

describe('Message being edited', () => {
  // The default look is a grid of named areas, and `.msg-body` is `display:
  // contents` there: a child with no area falls into the first column, 20px
  // wide. The edit box is laid out by the class that puts the text in its area.
  it('puts the edit box where the text goes', () => {
    useAuthStore.setState({ user: me });
    useChatStore.setState({ editingMessageId: message.id });
    render(<Message message={message} isCompact={false} isFirstInGroup previousMessageId={null} />);
    const box = screen.getByRole('textbox');
    expect(box.closest('.msg-content')).not.toBeNull();
    expect(box.closest('.msg-edit')).not.toBeNull();
    expect((box as HTMLTextAreaElement).value).toBe('Hello there');
  });

  // The box shows the name a mention goes by, and what is stored stays the token.
  it('reads a mention by name, and keeps its token when the text around it changes', async () => {
    const editMessage = vi.fn(async () => {});
    useAuthStore.setState({ user: me });
    useChatStore.setState({ editingMessageId: message.id, editMessage: editMessage as never });
    useSpaceStore.setState({ dmChannels: [{ id: 'c1', members: [me] } as never], channelOriginMap: new Map() });
    render(
      <Message
        message={{ ...message, content: `hi <@${me.id}>` }}
        isCompact={false}
        isFirstInGroup
        previousMessageId={null}
      />,
    );
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toBe('hi @Alice');
    fireEvent.change(box, { target: { value: 'hello @Alice', selectionStart: 5, selectionEnd: 5 } });
    await waitFor(() => expect(box.value).toBe('hello @Alice'));
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(editMessage).toHaveBeenCalledWith('m1', `hello <@${me.id}>`, 'c1'));
  });
});
