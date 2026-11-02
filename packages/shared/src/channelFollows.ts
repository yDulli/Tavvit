/**
 * Following an announcement channel (docs/systems/forums.md, "Announcement channels"): what is
 * posted there arrives as a copy in a text channel of another space on the same instance. An
 * edit or a deletion afterwards is not carried over.
 */
export const FOLLOW_LIMITS = {
  /** How many channels may follow one announcement channel: each post is copied to all of them. */
  PER_SOURCE_MAX: 25,
  /** How many channels one text channel may follow. */
  PER_TARGET_MAX: 10,
} as const;

export interface ChannelFollowInfo {
  id: string;
  /** The announcement channel, and its space. */
  sourceChannelId: string;
  sourceChannelName: string;
  sourceSpaceId: string;
  sourceSpaceName: string;
  /** The channel the posts arrive in, and its space. */
  targetChannelId: string;
  targetChannelName: string;
  targetSpaceId: string;
  targetSpaceName: string;
  createdAt: number;
}

export interface ChannelFollowsResponse {
  /** Who follows this channel, for someone who may manage it. */
  followers: ChannelFollowInfo[];
  /** What this channel follows, for someone who may manage its webhooks. */
  following: ChannelFollowInfo[];
}

/** Where someone may have an announcement channel's posts arrive. */
export interface FollowTargetSpace {
  id: string;
  name: string;
  channels: Array<{ id: string; name: string }>;
}
