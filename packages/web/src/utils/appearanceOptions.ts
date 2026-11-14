/**
 * The choices a person has over how Tavvit looks, apart from its colours: the
 * shape of corners and of avatars, how messages are drawn, how close together
 * they sit, the typeface, the width of the sidebar, the clock, and what helps
 * reading. Each is a small set of named options (a person picks a name, never a
 * raw number), kept in this browser (`appearanceStore`) and put on the page as a
 * data attribute or a CSS variable by `applyLook`. The stylesheet (globals.css)
 * is the one place that knows what an option looks like.
 */

export const CORNERS = ['sharp', 'standard', 'round'] as const;
export const MESSAGE_STYLES = ['rows', 'lines', 'bubbles'] as const;
export const DENSITIES = ['compact', 'cozy', 'spacious'] as const;
export const AVATAR_SHAPES = ['rounded', 'circle', 'square'] as const;
export const FONTS = ['outfit', 'geist', 'plexSans', 'inter', 'grotesk', 'mono', 'system'] as const;
export const SIDEBAR_WIDTHS = ['narrow', 'standard', 'wide'] as const;
export const CONTRASTS = ['standard', 'high'] as const;
export const LIGHTS = ['on', 'off'] as const;
export const STATUS_PALETTES = ['standard', 'accessible'] as const;
export const TIME_FORMATS = ['auto', '12h', '24h'] as const;

export type Corners = (typeof CORNERS)[number];
export type MessageStyle = (typeof MESSAGE_STYLES)[number];
export type Density = (typeof DENSITIES)[number];
export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type Font = (typeof FONTS)[number];
export type SidebarWidth = (typeof SIDEBAR_WIDTHS)[number];
export type Contrast = (typeof CONTRASTS)[number];
export type Light = (typeof LIGHTS)[number];
export type StatusPalette = (typeof STATUS_PALETTES)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];

/**
 * How much every radius is multiplied by, per corner option (`--radius-scale`). Standard is
 * Showomat's shape (pills and 24px frames); sharp squares everything, pills included.
 */
export const CORNER_SCALE: Record<Corners, number> = { sharp: 0, standard: 1, round: 1.5 };

export interface LookSettings {
  corners: Corners;
  messageStyle: MessageStyle;
  density: Density;
  avatarShape: AvatarShape;
  font: Font;
  sidebarWidth: SidebarWidth;
  contrast: Contrast;
  light: Light;
  underlineLinks: boolean;
  statusPalette: StatusPalette;
  timeFormat: TimeFormat;
}

export const DEFAULT_LOOK: LookSettings = {
  corners: 'standard',
  messageStyle: 'rows',
  density: 'cozy',
  avatarShape: 'rounded',
  font: 'outfit',
  sidebarWidth: 'standard',
  contrast: 'standard',
  light: 'on',
  underlineLinks: false,
  statusPalette: 'standard',
  timeFormat: 'auto',
};

/** The options of each choice, by the name of the setting. */
export const LOOK_OPTIONS = {
  corners: CORNERS,
  messageStyle: MESSAGE_STYLES,
  density: DENSITIES,
  avatarShape: AVATAR_SHAPES,
  font: FONTS,
  sidebarWidth: SIDEBAR_WIDTHS,
  contrast: CONTRASTS,
  light: LIGHTS,
  statusPalette: STATUS_PALETTES,
  timeFormat: TIME_FORMATS,
} as const satisfies Partial<Record<keyof LookSettings, readonly string[]>>;

export type OptionKey = keyof typeof LOOK_OPTIONS;

/** `value` when it is one of the options of `key`, otherwise the default. */
export function normalizeOption<K extends OptionKey>(key: K, value: unknown): LookSettings[K] {
  const options = LOOK_OPTIONS[key] as readonly string[];
  return (typeof value === 'string' && options.includes(value) ? value : DEFAULT_LOOK[key]) as LookSettings[K];
}

/** Every look setting, read defensively: another version or a hand-edited store must not break the page. */
export function normalizeLook(stored: unknown): LookSettings {
  const raw = (stored ?? {}) as Partial<Record<keyof LookSettings, unknown>>;
  return {
    corners: normalizeOption('corners', raw.corners),
    messageStyle: normalizeOption('messageStyle', raw.messageStyle),
    density: normalizeOption('density', raw.density),
    avatarShape: normalizeOption('avatarShape', raw.avatarShape),
    font: normalizeOption('font', raw.font),
    sidebarWidth: normalizeOption('sidebarWidth', raw.sidebarWidth),
    contrast: normalizeOption('contrast', raw.contrast),
    light: normalizeOption('light', raw.light),
    underlineLinks: raw.underlineLinks === true,
    statusPalette: normalizeOption('statusPalette', raw.statusPalette),
    timeFormat: normalizeOption('timeFormat', raw.timeFormat),
  };
}

/** The data attributes `applyLook` puts on the root: the name of each attribute and the setting that fills it. */
const ATTRIBUTES = {
  messageStyle: 'messageStyle',
  density: 'density',
  avatarShape: 'avatar',
  font: 'font',
  sidebarWidth: 'sidebar',
  contrast: 'contrast',
  light: 'light',
  statusPalette: 'statusPalette',
} as const satisfies Partial<Record<keyof LookSettings, string>>;

/** Puts the look on `root`: the attributes and the variable the stylesheet reads. */
export function applyLook(root: HTMLElement, look: LookSettings): void {
  for (const [setting, attribute] of Object.entries(ATTRIBUTES) as [keyof typeof ATTRIBUTES, string][]) {
    root.dataset[attribute] = look[setting];
  }
  if (look.underlineLinks) root.dataset.links = 'underline';
  else delete root.dataset.links;
  root.style.setProperty('--radius-scale', String(CORNER_SCALE[look.corners]));
}

/** Takes the look off the root again, back to what the stylesheet says on its own. */
export function clearLook(root: HTMLElement): void {
  for (const attribute of Object.values(ATTRIBUTES)) delete root.dataset[attribute];
  delete root.dataset.links;
  root.style.removeProperty('--radius-scale');
}
