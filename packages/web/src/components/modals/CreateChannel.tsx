import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { describeError } from '../../i18n/errors';
import { CHANNEL_TOPIC_MAX_LENGTH, normalizeChannelTopic } from '@backspace/shared/src/constants';
import { channelIconName } from '../../utils/channelKinds';
import { Icon } from '../ui/Icon';

const KINDS = ['text', 'voice', 'announcement', 'forum'] as const;

export function CreateChannelModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof KINDS)[number]>('text');
  const [topic, setTopic] = useState('');
  const [categoryId, setCategoryId] = useState<string | ''>('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const createChannel = useSpaceStore((s) => s.createChannel);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const categories = useSpaceStore((s) => s.categories);

  const isOpen = activeModal === 'createChannel';

  // Pre-select category when opened from a category's + button
  useEffect(() => {
    if (isOpen && modalData.categoryId) {
      setCategoryId(modalData.categoryId as string);
    }
  }, [isOpen, modalData.categoryId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('spaces:channel.create.nameRequired'));
      return;
    }

    if (!currentSpaceId) {
      setError(t('spaces:channel.create.noSpaceSelected'));
      return;
    }

    setIsLoading(true);
    try {
      await createChannel(currentSpaceId, name.trim(), type, normalizeChannelTopic(topic) ?? undefined, categoryId || undefined);
      closeModal();
      setName('');
      setTopic('');
      setType('text');
      setCategoryId('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('spaces:channel.create.title')} mobileStyle="sheet">
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-3 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label className="field-label">
            {t('spaces:channel.create.typeLabel')}
          </label>
          <div className="space-y-2">
            {KINDS.map((kind) => (
              <label
                key={kind}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors duration-100 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-soft ${
                  type === kind
                    ? 'border-accent-primary bg-accent-primary/[0.06]'
                    : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover'
                }`}
              >
                <input
                  type="radio"
                  name="channelType"
                  value={kind}
                  checked={type === kind}
                  onChange={() => setType(kind)}
                  className="sr-only"
                />
                <Icon name={channelIconName(kind)} size={20} className="flex-shrink-0 text-txt-tertiary" />
                <div className="min-w-0">
                  <div className="text-ui font-medium text-txt-primary">
                    {t(`spaces:channel.create.types.${kind}.name`)}
                  </div>
                  <div className="mt-0.5 text-meta leading-snug text-txt-tertiary">
                    {t(`spaces:channel.create.types.${kind}.description`)}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="field-label">
            {t('spaces:channel.create.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-standard w-full"
            placeholder={t('spaces:channel.create.namePlaceholder')}
            autoFocus
          />
        </div>

        {type !== 'voice' && (
          <div className="mb-4">
            <label className="field-label">
              {t('spaces:channel.create.topicLabel')}
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={CHANNEL_TOPIC_MAX_LENGTH}
              className="input-standard w-full"
              placeholder={t('spaces:channel.create.topicPlaceholder')}
            />
          </div>
        )}

        {categories.length > 0 && (
          <div className="mb-4">
            <label className="field-label">
              {t('spaces:channel.create.categoryLabel')}
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="input-standard w-full"
            >
              <option value="">{t('spaces:channel.create.noCategory')}</option>
              {[...categories].sort((a, b) => a.position - b.position).map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="sticky bottom-0 z-10 pointer-events-none">
          <div className="flex justify-end pt-3 pb-1">
            <div className="action-bar pointer-events-auto">
              <button
                type="button"
                onClick={closeModal}
                className="btn-quiet"
              >
                {t('common:actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={isLoading}
                aria-busy={isLoading}
                className="btn-primary"
              >
                {isLoading ? t('spaces:channel.create.submitting') : t('spaces:channel.create.submit')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
