import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { describeError } from '../../i18n/errors';

export function CreateCategoryModal() {
  const { t } = useTranslation(['spaces', 'common']);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const createCategory = useSpaceStore((s) => s.createCategory);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);

  const isOpen = activeModal === 'createCategory';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('spaces:category.create.nameRequired'));
      return;
    }

    if (!currentSpaceId) {
      setError(t('spaces:category.create.noSpaceSelected'));
      return;
    }

    setIsLoading(true);
    try {
      await createCategory(currentSpaceId, name.trim());
      closeModal();
      setName('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('spaces:category.create.title')} mobileStyle="sheet">
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-3 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label className="field-label">
            {t('spaces:category.create.nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-standard w-full"
            placeholder={t('spaces:category.create.namePlaceholder')}
            autoFocus
          />
        </div>

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
                {isLoading ? t('spaces:category.create.submitting') : t('spaces:category.create.submit')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
