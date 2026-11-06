import botCard from './assets/bot-card.webp?url';
import community from './assets/community.webp?url';
import phoneChannels from './assets/phone-channels.webp?url';
import phone from './assets/phone.webp?url';
import windowShot from './assets/window.webp?url';
import { LANDING_IMAGE_SIZES } from './imageSizes';

export interface LandingImage {
  src: string;
  width: number;
  height: number;
}

/** The product page's screens. `scripts/landing-shots` writes the files and their sizes. */
export const LANDING_IMAGES = {
  botCard: { src: botCard, ...LANDING_IMAGE_SIZES['bot-card'] },
  community: { src: community, ...LANDING_IMAGE_SIZES.community },
  phone: { src: phone, ...LANDING_IMAGE_SIZES.phone },
  phoneChannels: { src: phoneChannels, ...LANDING_IMAGE_SIZES['phone-channels'] },
  window: { src: windowShot, ...LANDING_IMAGE_SIZES.window },
} as const satisfies Record<string, LandingImage>;

/** One look of the app, as the stage's window can wear it (Stage.tsx): the theme's surface and accent. */
export interface Look {
  /** The theme's id in the app (`utils/appTheme.ts`), and the key of its name in the catalog. */
  key: 'carbon' | 'moss' | 'clay' | 'plum' | 'harbor' | 'custom' | 'ink';
  /** The accent the theme comes with, where the window has its signal. */
  accent: string;
  /** The theme's page surface, from which the window's steps of tone are taken. */
  surface: string;
}

/** The looks the visitor can lay on the window, the page's own first. */
export const LOOKS: readonly [Look, ...Look[]] = [
  { key: 'carbon', accent: '#7466e8', surface: '#191b1f' },
  { key: 'moss', accent: '#5a8f1c', surface: '#181b16' },
  { key: 'clay', accent: '#e0501f', surface: '#201a18' },
  { key: 'plum', accent: '#a23fd0', surface: '#1e191c' },
  { key: 'harbor', accent: '#0f7fc4', surface: '#14191e' },
  { key: 'custom', accent: '#d4376b', surface: '#26151b' },
  { key: 'ink', accent: '#0e8f7e', surface: '#111111' },
];
