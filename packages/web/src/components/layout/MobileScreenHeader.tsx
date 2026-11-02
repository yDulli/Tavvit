import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { BAR_BUTTON, BAR_TITLE } from './mobileClasses';

interface MobileScreenHeaderProps {
  title: string;
  rightActions?: React.ReactNode;
}

export function MobileScreenHeader({ title, rightActions }: MobileScreenHeaderProps) {
  const { t } = useTranslation('common');
  const popMobileScreen = useUIStore((s) => s.popMobileScreen);

  return (
    <header className="panel-bar flex h-12 items-center gap-1 bg-surface-base px-1">
      <button
        type="button"
        onClick={popMobileScreen}
        aria-label={t('actions.back')}
        className={BAR_BUTTON}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
      <h1 className={BAR_TITLE}>{title}</h1>
      {rightActions}
    </header>
  );
}
