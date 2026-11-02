import React from 'react';
import { MassMentionBadge } from './MassMentionBadge';
import { MentionBadge } from './MentionBadge';
import { replaceEmojiShortcodesInMarkdownSource, useEmojiShortcodeNames } from '../../utils/emojiShortcodes';
import { splitMentions } from '../../utils/mentionTokens';
import { splitCustomEmoji } from '@backspace/shared/src/customEmoji';
import { CustomEmojiImage } from '../ui/CustomEmojiImage';
import { isStickerMessage, messageTextForPreview } from '../../utils/stickerMessages';
import i18n from '../../i18n';
import { maskSpoilers } from '@backspace/shared/src/spoilers';

interface InlineMessageTextProps {
  content: string;
  /** The channel the text was written in; its mentions resolve there (see `MentionBadge`). */
  channelId: string | null;
  /** Names for mentions the channel's people cannot answer, by user id (see `MentionBadge`). */
  mentionedNames?: Readonly<Record<string, string>>;
}

/**
 * One line of message text without Markdown, as a reply preview shows it:
 * user, role, `@everyone` and `@here` tokens outside code become
 * non-interactive badges (the preview itself is the jump control; the scan is
 * the one the full message uses, see utils/mentionTokens.ts), `:shortcode:`
 * text becomes emoji (not inside code, and not where a colon is escaped as
 * `\:`), custom emoji tokens become their pictures, and everything else is
 * plain text. A sticker is its label
 * (`messageTextForPreview`).
 */
export function InlineMessageText({ content, channelId, mentionedNames }: InlineMessageTextProps) {
  useEmojiShortcodeNames();
  if (isStickerMessage(content)) return <>{messageTextForPreview(content)}</>;
  return (
    <>
      {splitMentions(maskSpoilers(content, i18n.t('chat:spoiler.hidden'))).map((part, i) => {
        switch (part.kind) {
          case 'user': return <MentionBadge key={i} userId={part.userId} channelId={channelId} fallbackName={mentionedNames?.[part.userId]} interactive={false} />;
          case 'role': return <MassMentionBadge key={i} roleId={part.roleId} channelId={channelId} />;
          case 'everyone': return <MassMentionBadge key={i} keyword={part.keyword} channelId={channelId} />;
          case 'text': return (
            <React.Fragment key={i}>
              {splitCustomEmoji(part.text).map((piece, j) => (piece.kind === 'emoji'
                ? <CustomEmojiImage key={j} id={piece.id} fallbackName={piece.name} />
                : replaceEmojiShortcodesInMarkdownSource(piece.text)))}
            </React.Fragment>
          );
        }
      })}
    </>
  );
}
