import { useUIStore } from '../stores/uiStore';

/**
 * Opens the settings, on a tab if one is named: a dialog on a window, a pushed screen on a
 * phone, where the dialog is not mounted (AppLayout's mobile branch).
 */
export function openUserSettings(tab?: string): void {
  const ui = useUIStore.getState();
  if (ui.isMobile) ui.pushMobileScreen(tab ? `settings-${tab}` : 'settings');
  else ui.openModal('userSettings', tab ? { tab } : {});
}
