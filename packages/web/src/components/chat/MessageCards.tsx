import type { Attachment } from '@backspace/shared';
import type { MessageCard } from '@backspace/shared/src/cards';
import { AttachmentRenderer } from './AttachmentRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';

function CardView({ card, attachments, channelId }: { card: MessageCard; attachments: readonly Attachment[]; channelId?: string | null | undefined }) {
  const image = card.imageAttachmentId ? attachments.find((attachment) => attachment.id === card.imageAttachmentId && attachment.mimetype.startsWith('image/')) : undefined;
  return (
    <article className="surface-card min-w-0 rounded-lg border-l-2 px-3 py-2.5" style={card.color ? { borderLeftColor: card.color } : undefined}>
      {card.title && (
        <p className="text-ui font-semibold break-words text-txt-primary">
          {card.url
            ? <a href={card.url} target="_blank" rel="noopener noreferrer nofollow" className="text-txt-link hover:underline">{card.title}</a>
            : card.title}
        </p>
      )}
      {card.text && (
        <div className="message-text mt-1 text-ui leading-[1.5] break-words whitespace-pre-wrap text-txt-secondary">
          <MarkdownRenderer content={card.text} {...(channelId ? { channelId } : {})} />
        </div>
      )}
      {card.fields && (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 desktop:grid-cols-3">
          {card.fields.map((field, at) => (
            <div key={`${field.name}:${at}`} className={`min-w-0 ${field.inline ? '' : 'desktop:col-span-3'}`}>
              <dt className="text-meta font-semibold break-words text-txt-primary">{field.name}</dt>
              <dd className="text-meta break-words whitespace-pre-wrap text-txt-secondary">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {image && <div className="mt-2"><AttachmentRenderer attachment={image} /></div>}
      {card.footer && <p className="mt-2 text-label break-words text-txt-tertiary">{card.footer}</p>}
    </article>
  );
}

/** What a bot or a webhook showed besides text (shared/src/cards.ts). Nothing in one is fetched from anywhere. */
export function MessageCards({ cards, attachments = [], channelId }: {
  cards: readonly MessageCard[];
  /** The message's own files, which a card's picture is one of. */
  attachments?: readonly Attachment[];
  channelId?: string | null | undefined;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-1.5">
      {cards.map((card, at) => <CardView key={at} card={card} attachments={attachments} channelId={channelId} />)}
    </div>
  );
}
