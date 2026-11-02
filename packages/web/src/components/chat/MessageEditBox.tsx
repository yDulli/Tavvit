import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { fromWireText } from '../../utils/emojiWire';
import { MentionPopover } from './MentionPopover';
import { MentionTextarea } from './MentionTextarea';
import { useMentionComposer } from './useMentionComposer';

interface MessageEditBoxProps {
  channelId: string;
  /** The message's text as stored, with its `<@id>` tokens. */
  content: string;
  onSave: (draft: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * A sent message being edited. The same textarea and mention handling as the
 * composer: a mention reads `@name` here as it does everywhere else, and stays
 * its token underneath; a custom emoji reads `:name:`, and `toWireText` turns it
 * back on saving. A component of its own, so a long list of messages does not
 * carry the mention picker's state on every row.
 */
export function MessageEditBox({ channelId, content, onSave, onCancel }: MessageEditBoxProps) {
  const { t } = useTranslation(['chat']);
  const [draft, setDraft] = useState(() => fromWireText(content, channelId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionAnchorRef = useRef<HTMLSpanElement>(null);
  const { mentionState, mentionMatches, mentionModel, selectMention, handleMentionKey, updateMention } = useMentionComposer({
    channelId,
    draftText: draft,
    textareaRef,
    onDraftChange: setDraft,
  });

  useEffect(() => {
    setDraft(fromWireText(content, channelId));
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [content, channelId]);

  // As tall as what is being edited, up to its CSS limit.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
  }, [mentionModel.text]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed) void onSave(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (handleMentionKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="msg-content msg-edit w-full">
      {mentionState && mentionMatches.length > 0 && (
        <MentionPopover
          candidates={mentionMatches}
          selectedIndex={mentionState.selectedIndex}
          onSelect={selectMention}
          anchorRef={mentionAnchorRef}
        />
      )}
      <MentionTextarea
        textareaRef={textareaRef}
        mentionAnchorRef={mentionAnchorRef}
        mentionStart={mentionState?.startIndex}
        model={mentionModel}
        onChange={updateMention}
        onKeyDown={handleKeyDown}
        className="input-standard message-text block w-full max-h-[calc(50*var(--app-vh))] resize-none leading-[1.5] scrollbar-thin"
        rows={1}
        autoFocus
      />
      <p className="text-meta text-txt-tertiary mt-1">
        <Trans
          t={t}
          i18nKey="chat:message.edit.hint"
          components={{ // i18n-check: allow-literal (the next line is an object key after a JSX element, not text)
            cancel: <button onClick={onCancel} className="text-txt-link hover:underline" />,
            save: <button onClick={save} className="text-txt-link hover:underline" />,
          }}
        />
      </p>
    </div>
  );
}
