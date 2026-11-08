import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageWithUser } from '@backspace/shared';
import type { UserNotice } from '@backspace/shared/src/legal';
import type { PlatformAuditEntry } from '@backspace/shared/src/platform';
import { removalSubject } from '@backspace/shared/src/adminRemoval';
import { initI18n } from '../../i18n';
import { HttpError } from '../../api/client';
import { AdminRemovalDialog } from './AdminRemovalDialog';
import { buildMessageMenuItems } from '../chat/messageMenuItems';
import { NoticeBody } from '../legal/LegalController';
import { PlatformAuditList } from './instanceSettingsPanels/PlatformAuditList';
import { ProfileRemovalSection } from '../admin/RemovalSections';

// An administrator removing content directly (docs/systems/admin.md, "Removing content"): the dialog
// every removal asks through, the message menu's item, and the notice the person gets in their words.

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

beforeAll(async () => {
  await initI18n();
});

afterEach(cleanup);

describe('AdminRemovalDialog', () => {
  it('asks for a reason before it removes, and hands on the ground and the reason trimmed', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<AdminRemovalDialog title="Remove this message" text="It goes for everyone." onRemove={onRemove} onClose={onClose} />);
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove).toBeDisabled();
    await user.type(screen.getByLabelText('Reason'), '  no');
    expect(remove).toBeDisabled();
    await user.type(screen.getByLabelText('Reason'), 'pe, this is hate.  ');
    await user.click(screen.getByRole('radio', { name: 'The law' }));
    await user.click(remove);
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith({ reason: 'nope, this is hate.', ground: 'illegal' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open with the server\'s refusal, and waits for what to remove where there is a choice', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const failing = vi.fn(async () => { throw new HttpError(403, 'forbidden', undefined, 'forbidden'); });
    const { rerender } = render(<AdminRemovalDialog title="Remove" text="Text" onRemove={failing} onClose={onClose} />);
    await user.type(screen.getByLabelText('Reason'), 'A real reason.');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    rerender(<AdminRemovalDialog title="Remove" text="Text" canSubmit={false} onRemove={failing} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});

describe('the message menu', () => {
  const message = { id: 'm1', channelId: 'c1', userId: 'u2', content: 'Hello', createdAt: 1, user: { id: 'u2', username: 'u2' } } as unknown as MessageWithUser;
  const menu = (onAdminRemove?: () => void) => buildMessageMenuItems({
    message,
    selectedText: '',
    previousMessageId: null,
    isAuthor: false,
    isDm: false,
    canAddReactions: false,
    canSendMessages: false,
    canManageMessages: false,
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReaction: vi.fn(),
    onOpenEmojiPicker: vi.fn(),
    onMarkUnread: vi.fn(),
    onAdminRemove,
  });

  it('offers removal as the administrator only to one', () => {
    expect(menu().some((item) => item.key === 'admin-remove')).toBe(false);
    const onAdminRemove = vi.fn();
    const item = menu(onAdminRemove).find((entry) => entry.key === 'admin-remove');
    expect(item).toMatchObject({ type: 'action', label: 'Remove as administrator', danger: true });
  });
});

describe('a removal notice', () => {
  const notice = (over: Partial<UserNotice>): UserNotice => ({
    id: 'n1', kind: 'profile_content_removed', ground: 'terms', note: 'Hate symbols.', subject: null, until: null, decision: null, createdAt: 1, readAt: null, ...over,
  } as UserNotice);

  it('names the parts of a profile in the person\'s own language', () => {
    render(<NoticeBody notice={notice({ subject: removalSubject({ parts: ['avatar', 'bio', 'unknown-part'] }) })} />);
    expect(screen.getByText('Profile picture and About me')).toBeInTheDocument();
    expect(screen.queryByText(/unknown-part/)).toBeNull();
    expect(screen.getByText('Hate symbols.')).toBeInTheDocument();
  });

  it('names the space, and a sticker by its name', () => {
    render(<NoticeBody notice={notice({ kind: 'space_content_removed', subject: removalSubject({ space: 'Night Shift', expression: 'sticker', name: 'Rude, sticker' }) })} />);
    expect(screen.getByText('In Night Shift')).toBeInTheDocument();
    expect(screen.getByText('Sticker “Rude, sticker”')).toBeInTheDocument();
  });
});

describe('the console', () => {
  const entry = (over: Partial<PlatformAuditEntry>): PlatformAuditEntry => ({
    id: '1', action: 'profile_content_remove', actor: null, targetType: 'user', targetId: 'u2', targetLabel: 'bob', reason: 'Hate symbols.', details: null, createdAt: 1, ...over,
  });

  it('logs what a removal took in the words the person was told', () => {
    render(<PlatformAuditList entries={[
      entry({ details: { parts: ['displayName', 'links'], ground: 'terms' } }),
      entry({ id: '2', action: 'space_content_remove', targetType: 'space', details: { expression: 'emoji', item: '9', name: 'rude', ground: 'illegal' } }),
    ]} />);
    expect(screen.getByText('Display name and Links')).toBeInTheDocument();
    expect(screen.getByText('Emoji :rude:')).toBeInTheDocument();
  });

  it('does not offer to remove from a profile another instance keeps, and says where it is done', () => {
    const { rerender } = render(<ProfileRemovalSection userId="u2" keptBy="other.example" onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove from profile…' })).toBeNull();
    expect(screen.getByText(/comes from other\.example/)).toBeInTheDocument();
    rerender(<ProfileRemovalSection userId="u2" keptBy={null} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove from profile…' })).toBeInTheDocument();
  });
});
