/** Whether a person is looking at this window. What the server is told, so they get no push meanwhile. */
export function windowInFocus(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}
