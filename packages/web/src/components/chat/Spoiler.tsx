import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Text someone chose to hide until a reader asks for it. It is in the page all along:
 * the reader's own client hides it, so this protects from reading by accident and no more.
 */
export function Spoiler({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('chat');
  const [revealed, setRevealed] = useState(false);

  if (revealed) return <span className="spoiler" data-revealed="true">{children}</span>;

  const reveal = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    setRevealed(true);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t('spoiler.reveal')}
      className="spoiler"
      onClick={reveal}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        reveal(event);
      }}
    >
      <span aria-hidden="true">{children}</span>
    </span>
  );
}
