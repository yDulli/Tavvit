import React from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../ui/Icon';

interface VoiceChatPanelProps {
  channelId: string;
  channelName: string;
}

export function VoiceChatPanel({ channelId, channelName }: VoiceChatPanelProps) {
  const { t } = useTranslation(['voice', 'common']);
  const toggleVoiceChat = useUIStore((s) => s.toggleVoiceChat);

  return (
    <div
      data-testid="voice-chat-panel"
      className="relative w-[340px] min-w-[280px] max-w-[42%] min-h-0 flex-shrink-0 overflow-hidden bg-surface-chat flex flex-col border-l border-border-hard"
    >
      {/* Chat header */}
      <div className="panel-bar pl-4 pr-3 flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-txt-primary text-lead tracking-[-0.01em]">{t('voice:chatPanel.title')}</span>
        <button
          onClick={toggleVoiceChat}
          className="icon-btn"
          title={t('voice:chatPanel.close')}
          aria-label={t('voice:chatPanel.close')}
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Messages */}
      <MessageList channelId={channelId} />

      {/* Input */}
      <MessageInput channelId={channelId} channelName={channelName} />
    </div>
  );
}
