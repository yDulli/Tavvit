/**
 * The figures of the product page's opening: every number is the app's own. They are written here
 * rather than imported, because the modules that hold them (`utils/appTheme.ts`, the shared types,
 * the server's group limits) would cost a visitor kilobytes for three numbers; `landing.test.tsx`
 * holds each one to its source, so a changed limit fails the test instead of leaving the page wrong.
 */
export const LANDING_FIGURES = {
  /** The ready-made themes: `THEME_IDS` in `utils/appTheme.ts` ("or your own colours" is the custom one). */
  themes: 7,
  /** How many people a group message holds: `GROUP_DM_MAX_MEMBERS` in the server's `utils/groupDmLimits.ts`. */
  group: 10,
  /** `MAX_MESSAGE_LENGTH` in `@backspace/shared`. */
  characters: 4000,
} as const;
