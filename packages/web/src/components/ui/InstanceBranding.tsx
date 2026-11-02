import { useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { documentTitle } from '../../utils/instanceBranding';

/**
 * Mounted once in App. Gives the page the name of the instance it came from:
 * the browser tab and the home-screen label on iOS. It renders nothing. The
 * instance's accent colour is applied by `AppearanceController`, which weighs
 * it against the colour the person chose for themselves.
 *
 * The info is the public one, so this works on the sign-in page too. Until it
 * arrives (or if it never does) the built-in name stays.
 */
export function InstanceBranding(): null {
  const info = useHomeInstanceInfo();
  const unread = useChatStore((s) => s.unreadChannels.size);
  const name = info?.name ?? null;

  useEffect(() => {
    document.title = documentTitle(name, unread);
  }, [name, unread]);

  useEffect(() => {
    const label = documentTitle(name, 0);
    document
      .querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
      ?.setAttribute('content', label);
  }, [name]);

  return null;
}
