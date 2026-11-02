import botCard from './assets/bot-card.webp';
import community from './assets/community.webp';
import event from './assets/event.webp';
import friends from './assets/friends.webp';
import lookA0 from './assets/look-a0.webp';
import lookA1 from './assets/look-a1.webp';
import lookA2 from './assets/look-a2.webp';
import lookA3 from './assets/look-a3.webp';
import lookA4 from './assets/look-a4.webp';
import lookA5 from './assets/look-a5.webp';
import lookA6 from './assets/look-a6.webp';
import phoneChannels from './assets/phone-channels.webp';
import phoneMembers from './assets/phone-members.webp';
import phone from './assets/phone.webp';
import poll from './assets/poll.webp';
import profile from './assets/profile.webp';
import spaceBooks from './assets/space-books.webp';
import spaceDev from './assets/space-dev.webp';
import spacePhoto from './assets/space-photo.webp';
import switcherCard from './assets/switcher-card.webp';
import switcher from './assets/switcher.webp';
import thread from './assets/thread.webp';
import voice from './assets/voice.webp';
import welcome from './assets/welcome.webp';
import windowShot from './assets/window.webp';
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

/** The fan of looks: the same conversation in one theme each, the plain one in front. */
export const LOOKS: readonly { position: number; image: LandingImage }[] = [
  { position: -3, image: { src: lookA1, ...LANDING_IMAGE_SIZES['look-a1'] } },
  { position: 3, image: { src: lookA2, ...LANDING_IMAGE_SIZES['look-a2'] } },
  { position: -2, image: { src: lookA4, ...LANDING_IMAGE_SIZES['look-a4'] } },
  { position: 2, image: { src: lookA6, ...LANDING_IMAGE_SIZES['look-a6'] } },
  { position: -1, image: { src: lookA5, ...LANDING_IMAGE_SIZES['look-a5'] } },
  { position: 1, image: { src: lookA3, ...LANDING_IMAGE_SIZES['look-a3'] } },
  { position: 0, image: { src: lookA0, ...LANDING_IMAGE_SIZES['look-a0'] } },
];
