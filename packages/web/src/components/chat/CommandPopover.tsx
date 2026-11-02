import { useTranslation } from 'react-i18next';
import type { ChannelCommand } from '@backspace/shared/src/bots';

interface CommandPopoverProps {
  commands: readonly ChannelCommand[];
  selected: number;
  onPick: (command: ChannelCommand) => void;
}

/** Above the composer while someone types `/`: what the bots in this channel answer to. */
export function CommandPopover({ commands, selected, onPick }: CommandPopoverProps) {
  const { t } = useTranslation('chat');
  return (
    <div role="listbox" aria-label={t('commands.title')} className="glass absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-lg p-1">
      {commands.map((command, at) => (
        <button
          key={`${command.botId}:${command.name}`}
          type="button"
          role="option"
          aria-selected={at === selected}
          // The textarea keeps the focus, so Enter and the arrows go on working.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(command)}
          data-active={at === selected ? 'true' : undefined}
          className="nav-item h-auto w-full flex-col items-start gap-0 py-1.5 text-left"
        >
          <span className="flex w-full min-w-0 items-baseline gap-2">
            <span className="truncate font-mono text-meta text-txt-primary">/{command.name}</span>
            <span className="ml-auto flex-shrink-0 text-label text-txt-tertiary">{command.botName}</span>
          </span>
          <span className="w-full truncate text-meta text-txt-tertiary">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
