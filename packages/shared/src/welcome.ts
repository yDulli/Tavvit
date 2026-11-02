/**
 * What a space says to someone new (docs/systems/spaces.md, "Welcome and rules"): a welcome,
 * its rules, and channels to start in. Rules can be made a condition of taking part.
 */

export const WELCOME_LIMITS = {
  WELCOME_MAX_LENGTH: 1000,
  RULES_MAX_LENGTH: 4000,
  CHANNELS_MAX: 5,
} as const;

/** What a member sees, and what their settings page edits. */
export interface SpaceWelcome {
  welcomeText: string | null;
  rulesText: string | null;
  rulesRequired: boolean;
  channels: Array<{ id: string; name: string }>;
  /** Rules are in force and this member has not agreed to them: they cannot take part until they do. */
  mustAccept: boolean;
  acceptedAt: number | null;
}

export interface SpaceWelcomeRequest {
  welcomeText?: string | null;
  rulesText?: string | null;
  rulesRequired?: boolean;
  channelIds?: string[];
}
