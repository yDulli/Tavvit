import botCard from './assets/bot-card.webp?url';
import community from './assets/community.webp?url';
import event from './assets/event.webp?url';
import friends from './assets/friends.webp?url';
import lookA0 from './assets/look-a0.webp?url';
import lookA1 from './assets/look-a1.webp?url';
import lookA2 from './assets/look-a2.webp?url';
import lookA3 from './assets/look-a3.webp?url';
import lookA4 from './assets/look-a4.webp?url';
import lookA5 from './assets/look-a5.webp?url';
import lookA6 from './assets/look-a6.webp?url';
import phoneChannels from './assets/phone-channels.webp?url';
import phoneMembers from './assets/phone-members.webp?url';
import phone from './assets/phone.webp?url';
import poll from './assets/poll.webp?url';
import profile from './assets/profile.webp?url';
import spaceBooks from './assets/space-books.webp?url';
import spaceDev from './assets/space-dev.webp?url';
import spacePhoto from './assets/space-photo.webp?url';
import switcherCard from './assets/switcher-card.webp?url';
import switcher from './assets/switcher.webp?url';
import thread from './assets/thread.webp?url';
import voice from './assets/voice.webp?url';
import welcome from './assets/welcome.webp?url';
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
  event: { src: event, ...LANDING_IMAGE_SIZES.event },
  friends: { src: friends, ...LANDING_IMAGE_SIZES.friends },
  phone: { src: phone, ...LANDING_IMAGE_SIZES.phone },
  phoneChannels: { src: phoneChannels, ...LANDING_IMAGE_SIZES['phone-channels'] },
  phoneMembers: { src: phoneMembers, ...LANDING_IMAGE_SIZES['phone-members'] },
  poll: { src: poll, ...LANDING_IMAGE_SIZES.poll },
  profile: { src: profile, ...LANDING_IMAGE_SIZES.profile },
  spaceBooks: { src: spaceBooks, ...LANDING_IMAGE_SIZES['space-books'] },
  spaceDev: { src: spaceDev, ...LANDING_IMAGE_SIZES['space-dev'] },
  spacePhoto: { src: spacePhoto, ...LANDING_IMAGE_SIZES['space-photo'] },
  switcher: { src: switcher, ...LANDING_IMAGE_SIZES.switcher },
  switcherCard: { src: switcherCard, ...LANDING_IMAGE_SIZES['switcher-card'] },
  thread: { src: thread, ...LANDING_IMAGE_SIZES.thread },
  voice: { src: voice, ...LANDING_IMAGE_SIZES.voice },
  welcome: { src: welcome, ...LANDING_IMAGE_SIZES.welcome },
  window: { src: windowShot, ...LANDING_IMAGE_SIZES.window },
} as const satisfies Record<string, LandingImage>;

/** One look of the app: the theme the picture was taken in (`scripts/landing-shots/shoot.mjs`). */
export interface Look {
  /** The theme's id in the app (`utils/appTheme.ts`), and the key of its name in the catalog. */
  key: 'carbon' | 'moss' | 'clay' | 'plum' | 'harbor' | 'custom' | 'ink';
  /** The accent the picture was taken with: the colour the chapter is lit in while this look is chosen. */
  accent: string;
  /** The theme's page surface, read from the picture, for its swatch. */
  surface: string;
  image: LandingImage;
}

/** The looks the visitor can pick, the plain one first: the same conversation in each. */
export const LOOKS: readonly Look[] = [
  { key: 'carbon', accent: '#7466e8', surface: '#191b1f', image: { src: lookA0, ...LANDING_IMAGE_SIZES['look-a0'] } },
  { key: 'moss', accent: '#5a8f1c', surface: '#181b16', image: { src: lookA1, ...LANDING_IMAGE_SIZES['look-a1'] } },
  { key: 'clay', accent: '#e0501f', surface: '#201a18', image: { src: lookA2, ...LANDING_IMAGE_SIZES['look-a2'] } },
  { key: 'plum', accent: '#a23fd0', surface: '#1e191c', image: { src: lookA3, ...LANDING_IMAGE_SIZES['look-a3'] } },
  { key: 'harbor', accent: '#0f7fc4', surface: '#14191e', image: { src: lookA4, ...LANDING_IMAGE_SIZES['look-a4'] } },
  { key: 'custom', accent: '#d4376b', surface: '#26151b', image: { src: lookA5, ...LANDING_IMAGE_SIZES['look-a5'] } },
  { key: 'ink', accent: '#0e8f7e', surface: '#111111', image: { src: lookA6, ...LANDING_IMAGE_SIZES['look-a6'] } },
];
