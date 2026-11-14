import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema, type DBHandle } from '../db/index.js';

/**
 * A membership ends: its row, and everything that was held through it in this space
 * (docs/systems/spaces.md, "Leaving, kick and ban"). Leaving, a kick and a ban all end it here, so
 * none of them can leave something behind that the others take:
 *
 * - **the roles.** `member_roles` has no tie to the member row, and what someone may do is read
 *   from it. A row left behind gave a kicked moderator every role back on joining again, with
 *   nobody able to take them away meanwhile, since the role routes answer "not a member".
 * - **overrides naming the member** on the space's channels and categories, for the same reason:
 *   a grant made to one person in one channel is not a grant to whoever they are after a kick.
 * - what they read, the threads they follow, voice restrictions, and the events they said they
 *   would come to (a reminder would otherwise still reach them with the event's title).
 *
 * Call it inside the transaction that records why the membership ended.
 */
export function removeMembershipRows(spaceId: string, userId: string, handle: DBHandle = getDb()): void {
  const channelsOfSpace = handle.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.spaceId, spaceId));
  const categoriesOfSpace = handle.select({ id: schema.channelCategories.id }).from(schema.channelCategories).where(eq(schema.channelCategories.spaceId, spaceId));
  const eventsOfSpace = handle.select({ id: schema.spaceEvents.id }).from(schema.spaceEvents).where(eq(schema.spaceEvents.spaceId, spaceId));

  handle.delete(schema.spaceMembers)
    .where(and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.spaceMembers.userId, userId))).run();
  handle.delete(schema.memberRoles)
    .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, userId))).run();
  handle.delete(schema.channelOverrides).where(and(
    eq(schema.channelOverrides.targetType, 'member'),
    eq(schema.channelOverrides.targetId, userId),
    inArray(schema.channelOverrides.channelId, channelsOfSpace),
  )).run();
  handle.delete(schema.categoryOverrides).where(and(
    eq(schema.categoryOverrides.targetType, 'member'),
    eq(schema.categoryOverrides.targetId, userId),
    inArray(schema.categoryOverrides.categoryId, categoriesOfSpace),
  )).run();
  handle.delete(schema.readStates)
    .where(and(eq(schema.readStates.userId, userId), inArray(schema.readStates.channelId, channelsOfSpace))).run();
  handle.delete(schema.threadMembers)
    .where(and(eq(schema.threadMembers.userId, userId), inArray(schema.threadMembers.threadId, channelsOfSpace))).run();
  handle.delete(schema.voiceRestrictions)
    .where(and(eq(schema.voiceRestrictions.spaceId, spaceId), eq(schema.voiceRestrictions.userId, userId))).run();
  handle.delete(schema.spaceEventRsvps)
    .where(and(eq(schema.spaceEventRsvps.userId, userId), inArray(schema.spaceEventRsvps.eventId, eventsOfSpace))).run();
}
