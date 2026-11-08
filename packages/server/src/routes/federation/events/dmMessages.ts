import { parseWaveform, waveformText } from '@backspace/shared/src/voiceMessages.js';
import { pushDmMessage } from '../../../utils/pushDelivery.js';
import path from 'node:path';
import { getDb, schema } from '../../../db/index.js';
import { normalizeOriginForCompare } from '../../../utils/federationAuth.js';
import { dmDeleteKey, hasAppliedEvent, recordAppliedEvent } from '../../../utils/federationAppliedEvents.js';
import { reopenClosedDmMembers } from '../../../utils/dmMemberClosed.js';
import { getGroupDmTargetOrigins } from '../../../utils/federationOutbox.js';
import { findOrCreateOneOnOne, mayBeOneOnOneRow, oneOnOneKey } from '../../../utils/dmConversation.js';
import { oneOnOneBlockRefusal } from '../../../utils/blocks.js';
import { loadDmChannelWire } from '../../../utils/dmChannelWire.js';
import { announceDmReconcile } from '../../../utils/dmConversationEvents.js';
import { deleteDmMessageHere } from '../../../utils/dmMessageDeletion.js';
import { rewriteRelayedMentions } from '../../../utils/federationMentions.js';
import { sanitizeUser } from '../../../utils/sanitize.js';
import { generateSnowflake } from '../../../utils/snowflake.js';
import { instanceOrigin, isStickerFrom, mayPostSticker, mediaOriginsFor, shownPicture } from '../../../utils/remoteMedia.js';
import { relayedMimetype } from '../../../utils/uploadTypes.js';
import { reactionLimitReached } from '../../../utils/reactions.js';
import { connectionManager } from '../../../ws/handler.js';
import { getDmMessageWithUser } from '../../dm.js';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { FederationMessageTarget, FederationRelayEvent, FederationRelayProfileSnapshot } from '@backspace/shared';
import { parseDmSystemEvent, RELAYABLE_DM_SYSTEM_EVENTS } from '@backspace/shared/src/dmSystemEvents.js';
import type { RelayDelivery } from './dispatch.js';
import { buildDmMessagePayload, dmChannelMembers, isRelayTarget, isUrlFromPeer, mayRelayInto, memberWithIdentity, nonMemberRefusal, resolveLocalDmMessage, resolveRelayedReplyTarget } from '../dmChannels.js';
import { attributionRefusal, extractDomain, findFederatedUser, isOwnDomain, relayActorOfUser, resolveOrCreateReplicatedUser, resolveRelayActor, sameRelayActor } from '../identity.js';
import { hydrateReplicatedUserProfile } from '../profile.js';
import { relayedConversationRefusal, relayedConversationRefusalFromStranger } from '../localConsent.js';
import { GROUP_DM_MAX_MEMBERS } from '../../../utils/groupDmLimits.js';

/** The most attachments of one relayed message this instance keeps and fetches. */
const RELAYED_ATTACHMENTS_MAX = 25;

export async function processCreateEvent(
  event: FederationRelayEvent,
  sourceInstance: string,
  peerOrigin: string,
  db: ReturnType<typeof getDb>,
  accepted: string[],
  rejected: Array<{ messageId: string; reason: string }>,
  delivery: RelayDelivery,
): Promise<void> {
  if (!event.message) {
    rejected.push({ messageId: event.messageId, reason: 'missing_message_payload' });
    return;
  }

  if (!event.participants || event.participants.length < 2) {
    rejected.push({ messageId: event.messageId, reason: 'missing_participants' });
    return;
  }
  // At most the people a conversation has, before anyone is looked up or made: a 1-on-1 is its
  // pair, a group at most its member cap.
  if (event.participants.length > (event.federatedId ? GROUP_DM_MAX_MEMBERS : 2)) {
    rejected.push({ messageId: event.messageId, reason: 'invalid_target' });
    return;
  }
  // This instance keeps a 1-on-1 only with one of its own people in it: one between people of
  // other instances is theirs, not this one's to store (and to download the files of).
  if (!event.federatedId && !event.participants.some((p) => typeof p.homeInstance === 'string' && isOwnDomain(extractDomain(p.homeInstance).toLowerCase()))) {
    rejected.push({ messageId: event.messageId, reason: 'invalid_target' });
    return;
  }

  // Attribution: message author must belong to source instance (FED-010)
  const refusal = attributionRefusal(event.message, sourceInstance, db);
  if (refusal) {
    console.warn(`[federation] Attribution refused (${refusal}) in create: message homeInstance=${extractDomain(event.message.homeInstance)} source=${extractDomain(sourceInstance)}`);
    rejected.push({ messageId: event.messageId, reason: refusal });
    return;
  }

  // A delete for this message reached us before the message did: it is gone
  // on its home, and this create is as good as already applied.
  if (hasAppliedEvent(sourceInstance, dmDeleteKey(event.messageId), db)) {
    rejected.push({ messageId: event.messageId, reason: 'duplicate' });
    return;
  }

  // Dedup: check for existing message with same source
  const existingMsg = db
    .select()
    .from(schema.dmMessages)
    .where(
      and(
        eq(schema.dmMessages.sourceInstance, sourceInstance),
        eq(schema.dmMessages.sourceMessageId, event.messageId),
      ),
    )
    .get();

  if (existingMsg) {
    rejected.push({ messageId: event.messageId, reason: 'duplicate' });
    return;
  }

  // Relayed system content is validated before anything is written: only an
  // event a peer relays as a message (a space invite) is stored, in its
  // canonical form (dm-system.md, "System messages").
  const isSystem = event.message.type === 'system';
  let systemContent: string | null = null;
  if (isSystem) {
    const systemEvent = parseDmSystemEvent(event.message.content);
    if (!systemEvent || !RELAYABLE_DM_SYSTEM_EVENTS.has(systemEvent.event)) {
      console.warn(`[federation] Refused relayed system message ${event.messageId} from ${extractDomain(sourceInstance)}: not a well-formed relayable system event`);
      rejected.push({ messageId: event.messageId, reason: 'invalid_system_message' });
      return;
    }
    // Whoever opens the conversation may fetch an invite's icon: a file of the space's instance or
    // of the sender's, and nothing anywhere else (utils/remoteMedia.ts). Whether it is fetched
    // without a yes is the reader's client's to decide (components/ui/Avatar.tsx).
    let stored = systemEvent;
    if (systemEvent.event === 'space_invite') {
      const spaceOrigin = instanceOrigin(systemEvent.spaceInstanceOrigin);
      const origins = spaceOrigin ? [...mediaOriginsFor(sourceInstance), spaceOrigin] : mediaOriginsFor(sourceInstance);
      stored = { ...systemEvent, snapshot: { ...systemEvent.snapshot, icon: shownPicture(systemEvent.snapshot.icon, origins) } };
    }
    systemContent = JSON.stringify(stored);
  }

  // Who the event names is looked up without making anyone (findFederatedUser, the lookup
  // resolveOrCreateReplicatedUser makes first): a refused event leaves no row here, and asks no
  // home for a profile or picture, which each new row does. A row is made, and the profiles the
  // event carries filled in, only once the event is allowed (below).
  const authorEntry = event.participants.find((p) => sameRelayActor(p, event.message!));
  // No participant is the author's identity: a group's event names nobody to look up, and a
  // 1-on-1's two people are someone other than its author.
  if (!authorEntry) {
    rejected.push({ messageId: event.messageId, reason: event.federatedId ? 'participant_not_found' : 'author_not_found' });
    return;
  }

  // A sticker is fetched by every reader here as soon as it shows, so it only comes from the
  // author's home or this instance (utils/remoteMedia.ts). The author is homed on the sender
  // (attribution, above), so their home is the one the message names.
  if (!isSystem && !isStickerFrom(event.message.content ?? '', mediaOriginsFor(event.message.homeInstance))) {
    rejected.push({ messageId: event.messageId, reason: 'sticker_elsewhere' });
    return;
  }

  const hintsOf = (entry: typeof authorEntry) => ({ username: entry.profile?.username, status: entry.profile?.status, deleted: entry.profile?.deleted });
  const knownAs = (entry: typeof authorEntry) => findFederatedUser(entry.homeUserId, entry.homeInstance, db, { username: entry.profile?.username });
  const authorKnown = knownAs(authorEntry);

  // Resolve local DM channel: group DMs carry a federatedId and the channel
  // must already exist (bootstrapped by a prior member_add event); 1-on-1 DMs
  // are computed from the pair of home user IDs and created on demand.
  let localDmChannelId: string;
  // Whether this event created this instance's copy of a 1-on-1.
  let createdCopy = false;
  let authorUser: typeof schema.users.$inferSelect;
  // The rows the event's profiles fill in once it is allowed.
  const profiled: Array<{ user: typeof schema.users.$inferSelect; profile: FederationRelayProfileSnapshot | undefined }> = [];

  if (event.federatedId) {
    // Group DM: look up by federated_id (channel must already exist from member_add bootstrap)
    const channel = db
      .select()
      .from(schema.dmChannels)
      .where(and(
        eq(schema.dmChannels.federatedId, event.federatedId),
        isNull(schema.dmChannels.deletedAt),
      ))
      .get();

    if (!channel) {
      rejected.push({ messageId: event.messageId, reason: 'channel_not_found' });
      return;
    }
    // A key names a group only: a sender puts it on a group's messages alone
    // (federationOutbox.ts), and a 1-on-1 found by one would take a message past
    // the checks a 1-on-1's create has (below), a block among them.
    if (mayBeOneOnOneRow({ owner_id: channel.ownerId, federated_id: channel.federatedId })) {
      console.warn(`[federation] Refused create in DM ${channel.id}: a conversation key names a 1-on-1`);
      rejected.push({ messageId: event.messageId, reason: 'invalid_target' });
      return;
    }
    // A member of this copy has a row here: an author nobody here knows is no member yet.
    if (!authorKnown || !mayRelayInto(dmChannelMembers(channel.id, db), authorKnown.id, sourceInstance)) {
      const reason = nonMemberRefusal(channel);
      console.warn(`[federation] Refused create in DM ${channel.id} (${reason}): the author is not a member, or ${extractDomain(sourceInstance)} is not a peer of the conversation`);
      rejected.push({ messageId: event.messageId, reason });
      return;
    }
    const settled = resolveOrCreateReplicatedUser(authorEntry.homeUserId, authorEntry.homeInstance, db, hintsOf(authorEntry));
    if (!settled) {
      rejected.push({ messageId: event.messageId, reason: 'participant_not_found' });
      return;
    }
    // The author is the row that IS the message's identity (`resolveRelayActor`), as for a 1-on-1 (below).
    const author = resolveRelayActor(event.message, db);
    if (author.kind !== 'found' || author.user.id !== settled.id) {
      rejected.push({ messageId: event.messageId, reason: 'author_not_found' });
      return;
    }
    authorUser = settled;
    profiled.push({ user: settled, profile: authorEntry.profile });
    localDmChannelId = channel.id;
  } else {
    // 1-on-1 DM: the conversation is the pair its federated_id is computed
    // from, so the pair is its membership, and is checked before any local
    // copy of the conversation is created. Its two people are two.
    const otherEntry = event.participants.find((p) => !sameRelayActor(p, event.message!));
    if (!otherEntry) {
      rejected.push({ messageId: event.messageId, reason: 'invalid_target' });
      return;
    }
    const otherKnown = knownAs(otherEntry);
    // One of this instance's people is in it (above), and they always have a row.
    if (!authorKnown && !otherKnown) {
      rejected.push({ messageId: event.messageId, reason: 'participant_not_found' });
      return;
    }
    // Each of the pair as the checks see them: their row, or, for someone not known here yet
    // (never one of this instance's people), where they are homed.
    const standIn = (entry: typeof authorEntry, known: typeof authorKnown) =>
      known ?? { id: `unknown:${entry.homeUserId}`, homeInstance: extractDomain(entry.homeInstance).toLowerCase() };
    const authorStand = standIn(authorEntry, authorKnown);
    if (!mayRelayInto([authorStand, standIn(otherEntry, otherKnown)], authorStand.id, sourceInstance)) {
      console.warn(`[federation] Refused 1-on-1 create: the author is not one of the pair, or ${extractDomain(sourceInstance)} is not a peer of the conversation`);
      rejected.push({ messageId: event.messageId, reason: 'invalid_target' });
      return;
    }
    // The person here is written to as the local routes would let them be (localConsent.ts): a
    // block either way, and their rule on who may start a conversation, for one not held here yet.
    // An author nobody here knows has nothing to block and no conversation held, so only someone
    // who takes messages from anyone gets one. With no row for the other, the person here is the
    // author, writing to someone homed elsewhere, whose home keeps their rules.
    let consent: string | null = null;
    if (authorKnown && otherKnown) {
      const held = db.select({ id: schema.dmChannels.id }).from(schema.dmChannels)
        .where(and(eq(schema.dmChannels.federatedId, oneOnOneKey(authorKnown, otherKnown)), isNull(schema.dmChannels.deletedAt)))
        .get();
      consent = relayedConversationRefusal(authorKnown.id, otherKnown, held === undefined, db);
    } else if (otherKnown) {
      consent = relayedConversationRefusalFromStranger(otherKnown);
    }
    if (consent) {
      console.warn(`[federation] Refused 1-on-1 create: the person here does not take it (${consent})`);
      rejected.push({ messageId: event.messageId, reason: 'recipient_refuses' });
      return;
    }
    // Allowed: the one known here is settled first, so the only row made is the last step.
    const [firstEntry, secondEntry] = authorKnown ? [authorEntry, otherEntry] : [otherEntry, authorEntry];
    const first = resolveOrCreateReplicatedUser(firstEntry.homeUserId, firstEntry.homeInstance, db, hintsOf(firstEntry));
    const second = first ? resolveOrCreateReplicatedUser(secondEntry.homeUserId, secondEntry.homeInstance, db, hintsOf(secondEntry)) : null;
    if (!first || !second) {
      rejected.push({ messageId: event.messageId, reason: 'participant_not_found' });
      return;
    }
    // The author is the row that IS the message's identity (`resolveRelayActor`), not the first
    // whose homeUserId matches: a participant bound by username can resolve to a row of another
    // identity.
    const authorRow = authorKnown ? first : second;
    const author = resolveRelayActor(event.message, db);
    if (author.kind !== 'found' || author.user.id !== authorRow.id) {
      rejected.push({ messageId: event.messageId, reason: 'author_not_found' });
      return;
    }
    authorUser = authorRow;
    profiled.push({ user: first, profile: firstEntry.profile }, { user: second, profile: secondEntry.profile });
    // Both members open: the message that creates a copy here is delivered
    // with it.
    const opened = findOrCreateOneOnOne(db, first, second, { open: 'both' });
    announceDmReconcile(opened.reconciled);
    localDmChannelId = opened.channelId;
    createdCopy = opened.created;
    // A call that rang here before this copy existed is bound to it now.
    connectionManager.lateBindFederatedCall(oneOnOneKey(first, second), localDmChannelId);
  }

  // The event is allowed: the profiles it carries fill in what this instance does not know yet.
  for (const entry of profiled) {
    if (!entry.profile) continue;
    const hydrated = await hydrateReplicatedUserProfile(entry.user, entry.profile, db);
    if (entry.user.id === authorUser.id) authorUser = hydrated;
  }

  // The wire's `replyToId` is the sender's local id and is never adopted; the
  // shared-coordinate `replyTo` is resolved inside this conversation instead.
  const replyToId = resolveRelayedReplyTarget(event.message.replyTo, sourceInstance, localDmChannelId, db);

  // Mention tokens carry the sender's ids; store them as this instance's.
  // System content was validated and canonicalized above.
  const content = systemContent ?? rewriteRelayedMentions(event.message.content, event.message.mentions, db);

  // Insert the message
  const localMessageId = generateSnowflake();
  db.insert(schema.dmMessages)
    .values({
      id: localMessageId,
      dmChannelId: localDmChannelId,
      userId: authorUser.id,
      content,
      type: isSystem ? 'system' : 'user',
      replyToId,
      createdAt: event.message.createdAt,
      editedAt: null,
      sourceInstance,
      sourceMessageId: event.messageId,
      encryptionVersion: 0,
      forwarded: event.message.forwarded === true,
    })
    .run();

  // Create attachment rows and queue file downloads (SSRF-validated).
  // Attachment rows are created immediately with filename = sourceUrl so the
  // initial WebSocket broadcast includes working remote URLs. The background
  // file worker will UPDATE the filename to the local path after download.
  if (event.message.attachments && event.message.attachments.length > 0) {
    const now = Date.now();
    // Every attachment is a row and a download here. A person attaches a handful; past that, the
    // rest of what a peer sends is left out rather than fetched.
    if (event.message.attachments.length > RELAYED_ATTACHMENTS_MAX) {
      console.warn(`[federation-relay] ${event.messageId} from ${extractDomain(sourceInstance)} named ${event.message.attachments.length} attachments; kept the first ${RELAYED_ATTACHMENTS_MAX}`);
    }
    for (const attachment of event.message.attachments.slice(0, RELAYED_ATTACHMENTS_MAX)) {
      if (!isUrlFromPeer(attachment.sourceUrl, peerOrigin)) {
        console.warn(
          `[federation-relay] Rejecting attachment URL ${attachment.sourceUrl}: not an upload on peer ${peerOrigin}`,
        );
        continue;
      }

      // Create the attachment row with sourceUrl as the interim filename.
      // AttachmentRenderer already handles filenames starting with 'http' —
      // it uses them as direct URLs. When the file worker downloads the file,
      // it updates this row's filename to the local path.
      const attachmentId = generateSnowflake();
      db.insert(schema.attachments)
        .values({
          id: attachmentId,
          dmMessageId: localMessageId,
          uploaderId: null,
          filename: attachment.sourceUrl,
          originalName: attachment.originalName,
          // The peer's word only for a type this server knows (utils/uploadTypes.ts).
          mimetype: relayedMimetype(attachment.mimetype, attachment.originalName),
          size: attachment.size,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          duration: attachment.duration ?? null,
          playable: attachment.playable ?? null,
          spoiler: attachment.spoiler === true,
          voiceWaveform: waveformText(attachment.voiceWaveform),
          thumbnailFilename: null,  // Don't copy source thumbnail — it doesn't exist locally
          sourceUrl: attachment.sourceUrl,
          createdAt: now,
        })
        .run();

      // Queue the background file download
      db.insert(schema.federationFileQueue)
        .values({
          id: generateSnowflake(),
          peerOrigin,
          dmMessageId: localMessageId,
          sourceUrl: attachment.sourceUrl,
          originalName: attachment.originalName,
          mimetype: relayedMimetype(attachment.mimetype, attachment.originalName),
          size: attachment.size,
          status: 'pending',
          nextRetryAt: now,
          expiresAt: now + 30 * 86_400_000,
          createdAt: now,
        })
        .run();
    }
  }

  // A live message reopens the conversation for every member who closed it,
  // and dm_channel_created resurfaces it in their list before the message
  // arrives. A pulled message reopens it only for a member who closed it
  // before the message was written: a pull can deliver an old message long
  // after it was sent, and a close made after it stands. The live rule does
  // not compare the two: `createdAt` is the sender's clock and the close
  // time this instance's, and a sender clock running behind would otherwise
  // keep a fresh reply from reopening.
  const reopened = reopenClosedDmMembers(
    db.$client,
    localDmChannelId,
    delivery === 'live' ? {} : { closedBefore: event.message.createdAt },
  );
  const fullMessage = getDmMessageWithUser(localMessageId);
  if (createdCopy && delivery === 'catch_up') {
    // A pulled message that created this copy of a 1-on-1 raises nothing
    // live (no dm_message_created below), so the members' lists learn of the
    // conversation here, as a listing would show it. dm_channel_created makes
    // no sound: catch-up is not news.
    const payload = loadDmChannelWire(db, localDmChannelId);
    if (payload) {
      for (const member of payload.members) {
        connectionManager.sendToUser(member.id, { type: 'dm_channel_created', dmChannel: payload });
      }
    }
  } else if (reopened.length > 0) {
    const payload = loadDmChannelWire(db, localDmChannelId, delivery === 'live' ? fullMessage ?? undefined : undefined);
    if (payload) {
      for (const userId of reopened) {
        connectionManager.sendToUser(userId, { type: 'dm_channel_created', dmChannel: payload });
      }
    }
  }

  // Live delivery goes to every local member, members homed on the source
  // instance included. Federated DMs are mirrored: a client connected here and
  // to the source holds both copies of the conversation, and its DM merge
  // module (web `stores/dmConversations.ts`) decides which copy it shows, so
  // each copy gets its own messages. A pulled message is catch-up
  // (`RelayDelivery`): it is stored, and shows when a client next loads the
  // conversation, without raising a sound or notification now.
  if (fullMessage && delivery === 'live') {
    const dmMembers = db.select({ userId: schema.dmMembers.userId })
      .from(schema.dmMembers)
      .where(eq(schema.dmMembers.dmChannelId, localDmChannelId))
      .all();
    for (const member of dmMembers) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_message_created',
        message: fullMessage,
      });
    }
    pushDmMessage(fullMessage, (id) => connectionManager.isUserFocused(id));
  }

  // Belt-and-suspenders: clear typing indicator for the author on inbound relay.
  // This catches the case where the explicit dm_typing_stop relay was lost.
  const relayDmMembers = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, localDmChannelId))
    .all();

  for (const member of relayDmMembers) {
    if (member.userId !== authorUser.id) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_typing_stop',
        dmChannelId: localDmChannelId,
        userId: authorUser.id,
      });
    }
  }

  accepted.push(event.messageId);
}


type RelayedMutationResolution =
  | { ok: true; localMsg: typeof schema.dmMessages.$inferSelect }
  | {
    ok: false;
    reason: 'unknown_message' | 'invalid_target' | 'attribution_mismatch' | 'attribution_unproven' | 'not_message_author';
  };

function isMessageTarget(value: unknown): value is FederationMessageTarget {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<FederationMessageTarget>;
  return typeof t.federatedId === 'string' && t.federatedId.length > 0
    && typeof t.message?.messageId === 'string' && t.message.messageId.length > 0
    && typeof t.message.messageHomeInstance === 'string' && t.message.messageHomeInstance.length > 0
    && typeof t.actor?.homeUserId === 'string' && typeof t.actor.homeInstance === 'string';
}

/**
 * Whether `sourceInstance` may address `localMsg` by a relayed `target`: it is
 * one of the origins this instance relays the message's conversation to, or it
 * is the instance the message itself arrived from. Any other peer never
 * received the conversation, so a target from it is refused whatever actor it
 * names. The message's own source is compared host to host, since it and the
 * signed source can differ in scheme; the relay targets as `isRelayTarget`
 * compares them.
 */
export function isPeerOfMessage(
  localMsg: typeof schema.dmMessages.$inferSelect,
  sourceInstance: string,
): boolean {
  const source = normalizeOriginForCompare(sourceInstance);
  if (!source) return false;
  if (normalizeOriginForCompare(localMsg.sourceInstance) === source) return true;
  return isRelayTarget(getGroupDmTargetOrigins(localMsg.dmChannelId), sourceInstance);
}

/**
 * Why a relayed reaction on `localMsg` is refused, or null. The sender must be
 * a peer of the message's conversation (`isPeerOfMessage`, else
 * `invalid_target`), and the reactor a member of it, matched by federated
 * identity, as the local reaction handlers require of a reacting user (else
 * `nonMemberRefusal`).
 */
function reactionScopeRefusal(
  localMsg: typeof schema.dmMessages.$inferSelect,
  reactor: { homeUserId: string; homeInstance: string },
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
): 'invalid_target' | 'unauthorized_source' | null {
  if (!isPeerOfMessage(localMsg, sourceInstance)) return 'invalid_target';
  if (memberWithIdentity(dmChannelMembers(localMsg.dmChannelId, db), reactor)) return null;
  const channel = db
    .select({ ownerId: schema.dmChannels.ownerId })
    .from(schema.dmChannels)
    .where(eq(schema.dmChannels.id, localMsg.dmChannelId))
    .get();
  return channel ? nonMemberRefusal(channel) : 'invalid_target';
}

/**
 * Find the local message a relayed `update` or `delete` changes, and decide
 * whether the actor may change it. The rule is documented in
 * docs/systems/dm-system.md, "Relayed edits and deletes":
 *
 * - With a `target`, `attributionRefusal` must find nothing to refuse for the
 *   actor against the signing peer (`attribution_unproven` is retried, as for
 *   every relay event), the message is resolved in shared coordinates inside this
 *   instance's copy of the conversation `target.federatedId`, and the actor
 *   must be the message's author, compared as federated identities. The
 *   signing peer must be one the conversation is relayed to, or the instance
 *   the message came from (`isPeerOfMessage`); else `invalid_target`,
 *   terminal. A target that does not resolve (yet) is `unknown_message`, which
 *   the sender retries with backoff. A message by someone else is
 *   `not_message_author`, terminal, and nothing is changed.
 * - Without one (an older sender), the event's `messageId` is the sender's
 *   local id and only matches a message the sender itself created and relayed
 *   here, so the lookup `(sourceInstance, messageId)` is its own authorization.
 */
function resolveRelayedMutationTarget(
  event: FederationRelayEvent,
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
): RelayedMutationResolution {
  if (event.target === undefined) {
    const legacy = db
      .select()
      .from(schema.dmMessages)
      .where(
        and(
          eq(schema.dmMessages.sourceInstance, sourceInstance),
          eq(schema.dmMessages.sourceMessageId, event.messageId),
        ),
      )
      .get();
    return legacy ? { ok: true, localMsg: legacy } : { ok: false, reason: 'unknown_message' };
  }

  const target: unknown = event.target;
  if (!isMessageTarget(target)) return { ok: false, reason: 'invalid_target' };

  const refusal = attributionRefusal(target.actor, sourceInstance, db);
  if (refusal) {
    console.warn(`[federation] Attribution refused (${refusal}) in ${event.eventType}: actor homeInstance=${extractDomain(target.actor.homeInstance)} source=${extractDomain(sourceInstance)}`);
    return { ok: false, reason: refusal };
  }

  const channel = db
    .select({ id: schema.dmChannels.id })
    .from(schema.dmChannels)
    .where(and(eq(schema.dmChannels.federatedId, target.federatedId), isNull(schema.dmChannels.deletedAt)))
    .get();
  if (!channel) return { ok: false, reason: 'unknown_message' };

  const localMsg = resolveLocalDmMessage(
    target.message.messageId,
    target.message.messageHomeInstance,
    sourceInstance,
    db,
  );
  if (!localMsg || localMsg.dmChannelId !== channel.id) return { ok: false, reason: 'unknown_message' };

  if (!isPeerOfMessage(localMsg, sourceInstance)) {
    console.warn(`[federation] Refused ${event.eventType} of message ${localMsg.id}: ${extractDomain(sourceInstance)} is not a peer of its conversation`);
    return { ok: false, reason: 'invalid_target' };
  }

  const author = db
    .select({ id: schema.users.id, homeUserId: schema.users.homeUserId, homeInstance: schema.users.homeInstance })
    .from(schema.users)
    .where(eq(schema.users.id, localMsg.userId))
    .get();
  const authorIdentity = author ? relayActorOfUser(author) : null;
  if (!authorIdentity || !sameRelayActor(authorIdentity, target.actor)) {
    console.warn(`[federation] Refused ${event.eventType} of message ${localMsg.id}: the relayed actor is not its author`);
    return { ok: false, reason: 'not_message_author' };
  }

  return { ok: true, localMsg };
}


export function processUpdateEvent(
  event: FederationRelayEvent,
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
  accepted: string[],
  rejected: Array<{ messageId: string; reason: string }>,
): void {
  // Attribution: if homeInstance present, verify it matches source (FED-010)
  if (event.message?.homeInstance) {
    const refusal = attributionRefusal(event.message, sourceInstance, db);
    if (refusal) {
      console.warn(`[federation] Attribution refused (${refusal}) in update: message homeInstance=${extractDomain(event.message.homeInstance)} source=${extractDomain(sourceInstance)}`);
      rejected.push({ messageId: event.messageId, reason: refusal });
      return;
    }
  }

  const resolved = resolveRelayedMutationTarget(event, sourceInstance, db);
  if (!resolved.ok) {
    rejected.push({ messageId: event.messageId, reason: resolved.reason });
    return;
  }
  const localMsg = resolved.localMsg;

  // System messages cannot be edited (dm-system.md, "System messages").
  if (localMsg.type === 'system') {
    console.warn(`[federation] Refused relayed update of system message ${localMsg.id} from ${extractDomain(sourceInstance)}`);
    rejected.push({ messageId: event.messageId, reason: 'system_message_immutable' });
    return;
  }

  if (!mayPostSticker(event.message?.content, localMsg.userId)) {
    rejected.push({ messageId: event.messageId, reason: 'sticker_elsewhere' });
    return;
  }

  // Mention tokens carry the sender's ids; store them as this instance's.
  const content = rewriteRelayedMentions(event.message?.content ?? null, event.message?.mentions, db);

  // Last-writer-wins on the author's `editedAt`: an edit this copy already
  // holds, or an older one arriving after it (a pull replays the log), changes
  // nothing and tells nobody. An older sender without `editedAt` is applied
  // only when the content differs.
  const incomingEditedAt = event.message?.editedAt ?? null;
  const alreadyHeld = incomingEditedAt !== null
    ? localMsg.editedAt !== null && incomingEditedAt <= localMsg.editedAt
    : content === localMsg.content;
  if (alreadyHeld) {
    accepted.push(event.messageId);
    return;
  }
  const editedAt = incomingEditedAt ?? Date.now();

  db.update(schema.dmMessages)
    .set({ content, editedAt })
    .where(eq(schema.dmMessages.id, localMsg.id))
    .run();

  // Broadcast update to local clients
  const authorUser = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, localMsg.userId))
    .get();

  if (authorUser) {
    const updatedPayload = buildDmMessagePayload(
      {
        id: localMsg.id,
        dmChannelId: localMsg.dmChannelId,
        userId: localMsg.userId,
        content,
        replyToId: localMsg.replyToId,
        editedAt,
        createdAt: localMsg.createdAt,
      },
      authorUser,
    );

    // Re-fetch reactions and attachments for the complete payload
    const reactions = db
      .select()
      .from(schema.dmReactions)
      .where(eq(schema.dmReactions.dmMessageId, localMsg.id))
      .all();

    const attachments = db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.dmMessageId, localMsg.id))
      .all();

    updatedPayload.reactions = reactions.map(r => ({
      id: r.id,
      messageId: r.dmMessageId,
      userId: r.userId,
      emoji: r.emoji,
      createdAt: r.createdAt,
    }));

    updatedPayload.attachments = attachments.map(a => ({
      id: a.id,
      messageId: a.dmMessageId ?? a.messageId ?? '',
      filename: a.filename,
      originalName: a.originalName,
      mimetype: a.mimetype,
      size: a.size,
      thumbnailFilename: a.thumbnailFilename,
      width: a.width,
      height: a.height,
      duration: a.duration,
      playable: a.playable ?? null,
      spoiler: a.spoiler,
      voiceWaveform: parseWaveform(a.voiceWaveform),
      createdAt: a.createdAt,
    }));

    connectionManager.sendToDmMembers(localMsg.dmChannelId, {
      type: 'dm_message_updated',
      message: updatedPayload,
    });
  }

  accepted.push(event.messageId);
}


/**
 * The message a relayed delete names, in its home's coordinates: the target's
 * shared coordinates, or for an older sender without a target, the sender's
 * own id on the sender. Null for a target too malformed to name one.
 */
function relayedDeleteCoordinates(
  event: FederationRelayEvent,
  sourceInstance: string,
): { messageId: string; homeInstance: string } | null {
  if (event.target === undefined) return { messageId: event.messageId, homeInstance: sourceInstance };
  const target: unknown = event.target;
  if (!isMessageTarget(target)) return null;
  return { messageId: target.message.messageId, homeInstance: target.message.messageHomeInstance };
}

/**
 * Record that the message at `coordinates` is deleted, so a create of it that
 * arrives later is answered `duplicate` (`processCreateEvent`). Only a message
 * homed on the signing peer: that peer is the only one whose creates carry
 * those coordinates, so no peer can block another's messages this way.
 */
function recordDeleteTombstone(
  coordinates: { messageId: string; homeInstance: string },
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
): void {
  if (normalizeOriginForCompare(coordinates.homeInstance) !== normalizeOriginForCompare(sourceInstance)) return;
  recordAppliedEvent(sourceInstance, dmDeleteKey(coordinates.messageId), db);
}


export function processDeleteEvent(
  event: FederationRelayEvent,
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
  accepted: string[],
  rejected: Array<{ messageId: string; reason: string }>,
): void {
  const resolved = resolveRelayedMutationTarget(event, sourceInstance, db);
  if (!resolved.ok) {
    const coordinates = relayedDeleteCoordinates(event, sourceInstance);
    if (resolved.reason === 'unknown_message' && coordinates
      && !resolveLocalDmMessage(coordinates.messageId, coordinates.homeInstance, sourceInstance, db)) {
      // Not held here: nothing to delete, and the create may still be on its
      // way. Accept, and leave the tombstone that answers that create.
      recordDeleteTombstone(coordinates, sourceInstance, db);
      accepted.push(event.messageId);
      return;
    }
    rejected.push({ messageId: event.messageId, reason: resolved.reason });
    return;
  }
  const localMsg = resolved.localMsg;

  // A create of this message delivered again later (an outbox retry whose
  // first send did land) must not bring it back.
  if (localMsg.sourceInstance && localMsg.sourceMessageId) {
    recordDeleteTombstone(
      { messageId: localMsg.sourceMessageId, homeInstance: localMsg.sourceInstance },
      sourceInstance,
      db,
    );
  }

  deleteDmMessageHere(db, localMsg);

  accepted.push(event.messageId);
}


export function processReactionAddEvent(
  event: FederationRelayEvent,
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
  accepted: string[],
  rejected: Array<{ messageId: string; reason: string }>,
): void {
  if (!event.reaction) {
    rejected.push({ messageId: event.messageId, reason: 'missing_reaction_payload' });
    return;
  }

  // Attribution: reacting user must belong to source instance (FED-010)
  const refusal = attributionRefusal(event.reaction, sourceInstance, db);
  if (refusal) {
    console.warn(`[federation] Attribution refused (${refusal}) in reaction_add: reaction homeInstance=${event.reaction.homeInstance ? extractDomain(event.reaction.homeInstance) : 'missing'} source=${extractDomain(sourceInstance)}`);
    rejected.push({ messageId: event.messageId, reason: refusal });
    return;
  }

  const canonicalMessageId = event.reaction.messageId ?? event.messageId;
  const localMsg = resolveLocalDmMessage(
    canonicalMessageId,
    event.reaction.messageHomeInstance,
    sourceInstance,
    db,
  );

  // The sender must be a peer of the message's conversation and the reactor
  // a member of it ("Inbound: Reaction Add/Remove" in dm-system.md).
  const scopeRefusal = localMsg ? reactionScopeRefusal(localMsg, event.reaction, sourceInstance, db) : null;
  if (localMsg && scopeRefusal) {
    console.warn(`[federation] Refused reaction_add on message ${localMsg.id} (${scopeRefusal}): ${extractDomain(sourceInstance)} is not a peer of its conversation, or the reactor is not a member`);
    rejected.push({ messageId: event.messageId, reason: scopeRefusal });
    return;
  }

  if (!localMsg) {
    rejected.push({ messageId: event.messageId, reason: 'unknown_message' });
    return;
  }

  // The reactor is the local user that IS the attributed identity, matched on
  // homeUserId + homeInstance; see `resolveRelayActor`.
  const reactor = resolveRelayActor(event.reaction, db);
  if (reactor.kind === 'mismatch') {
    console.warn('[federation] Refused reaction_add: the reactor homeUserId names a local user of another identity');
    rejected.push({ messageId: event.messageId, reason: 'attribution_mismatch' });
    return;
  }
  if (reactor.kind === 'unknown') {
    rejected.push({ messageId: event.messageId, reason: 'user_not_found' });
    return;
  }
  const reactingUser = reactor.user;
  if (!mayPostSticker(event.reaction.emoji, reactingUser.id)) {
    rejected.push({ messageId: event.messageId, reason: 'sticker_elsewhere' });
    return;
  }
  // A block stops reactions in a 1-on-1 as it stops messages, either way, as the local handler
  // refuses them (ws/events.ts, utils/blocks.ts).
  if (oneOnOneBlockRefusal(localMsg.dmChannelId, reactingUser.id, db)) {
    rejected.push({ messageId: event.messageId, reason: 'recipient_refuses' });
    return;
  }
  // As many different reactions as a message here may carry (utils/reactions.ts).
  if (reactionLimitReached('dm', localMsg.id, event.reaction.emoji)) {
    rejected.push({ messageId: event.messageId, reason: 'invalid_payload' });
    return;
  }

  const reactionId = generateSnowflake();
  const now = event.reaction.createdAt || Date.now();

  // The unique index on (dm_message_id, user_id, emoji) keeps one reaction
  // per user and emoji. A reaction this instance already holds (a redelivery,
  // or the same event pulled again by the catch-up sync) inserts nothing and
  // is accepted, so the sender stops retrying it.
  const inserted = db.insert(schema.dmReactions)
    .values({
      id: reactionId,
      dmMessageId: localMsg.id,
      userId: reactingUser.id,
      emoji: event.reaction.emoji,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (inserted.changes === 0) {
    accepted.push(event.messageId);
    return;
  }

  // Broadcast to local clients
  connectionManager.sendToDmMembers(localMsg.dmChannelId, {
    type: 'reaction_added',
    messageId: localMsg.id,
    reaction: {
      id: reactionId,
      messageId: localMsg.id,
      userId: reactingUser.id,
      emoji: event.reaction.emoji,
      createdAt: now,
      user: sanitizeUser(reactingUser),
    },
  });

  accepted.push(event.messageId);
}


/**
 * A conversation's message being pinned or unpinned on a peer. The checks are a
 * reaction's: the sender's attribution, a peer of the conversation, a member of
 * it. Each event sets the whole state, so a redelivery changes nothing and an
 * older state does not replace a newer one.
 */
export function processPinSetEvent(
  event: FederationRelayEvent,
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
  accepted: string[],
  rejected: Array<{ messageId: string; reason: string }>,
): void {
  const pin = event.pin;
  if (!pin) {
    rejected.push({ messageId: event.messageId, reason: 'missing_pin_payload' });
    return;
  }

  const refusal = attributionRefusal(pin, sourceInstance, db);
  if (refusal) {
    console.warn(`[federation] Attribution refused (${refusal}) in pin_set: homeInstance=${pin.homeInstance ? extractDomain(pin.homeInstance) : 'missing'} source=${extractDomain(sourceInstance)}`);
    rejected.push({ messageId: event.messageId, reason: refusal });
    return;
  }

  const localMsg = resolveLocalDmMessage(pin.messageId, pin.messageHomeInstance, sourceInstance, db);
  if (!localMsg) {
    rejected.push({ messageId: event.messageId, reason: 'unknown_message' });
    return;
  }

  const scopeRefusal = reactionScopeRefusal(localMsg, pin, sourceInstance, db);
  if (scopeRefusal) {
    console.warn(`[federation] Refused pin_set on message ${localMsg.id} (${scopeRefusal}): ${extractDomain(sourceInstance)} is not a peer of its conversation, or the actor is not a member`);
    rejected.push({ messageId: event.messageId, reason: scopeRefusal });
    return;
  }

  const actor = resolveRelayActor(pin, db);
  if (actor.kind === 'mismatch') {
    console.warn('[federation] Refused pin_set: the actor homeUserId names a local user of another identity');
    rejected.push({ messageId: event.messageId, reason: 'attribution_mismatch' });
    return;
  }
  if (actor.kind === 'unknown') {
    rejected.push({ messageId: event.messageId, reason: 'user_not_found' });
    return;
  }

  // A system row takes no pin here either, and a state older than the one held changes nothing.
  if (localMsg.type === 'system' || pin.at < (localMsg.pinChangedAt ?? 0)) {
    accepted.push(event.messageId);
    return;
  }

  const pinnedAt = pin.pinned ? pin.at : null;
  const pinnedBy = pin.pinned ? actor.user.id : null;
  db.update(schema.dmMessages)
    .set({ pinnedAt, pinnedBy, pinChangedAt: pin.at })
    .where(eq(schema.dmMessages.id, localMsg.id))
    .run();

  connectionManager.sendToDmMembers(localMsg.dmChannelId, {
    type: 'message_pin_changed',
    channelId: localMsg.dmChannelId,
    messageId: localMsg.id,
    pinnedAt,
    pinnedBy,
  });

  accepted.push(event.messageId);
}


export function processReactionRemoveEvent(
  event: FederationRelayEvent,
  sourceInstance: string,
  db: ReturnType<typeof getDb>,
  accepted: string[],
  rejected: Array<{ messageId: string; reason: string }>,
): void {
  if (!event.reaction) {
    rejected.push({ messageId: event.messageId, reason: 'missing_reaction_payload' });
    return;
  }

  // Attribution: reacting user must belong to source instance (FED-010)
  const refusal = attributionRefusal(event.reaction, sourceInstance, db);
  if (refusal) {
    console.warn(`[federation] Attribution refused (${refusal}) in reaction_remove: reaction homeInstance=${event.reaction.homeInstance ? extractDomain(event.reaction.homeInstance) : 'missing'} source=${extractDomain(sourceInstance)}`);
    rejected.push({ messageId: event.messageId, reason: refusal });
    return;
  }

  const canonicalMessageId = event.reaction.messageId ?? event.messageId;
  const localMsg = resolveLocalDmMessage(
    canonicalMessageId,
    event.reaction.messageHomeInstance,
    sourceInstance,
    db,
  );

  // The sender must be a peer of the message's conversation and the reactor
  // a member of it ("Inbound: Reaction Add/Remove" in dm-system.md).
  const scopeRefusal = localMsg ? reactionScopeRefusal(localMsg, event.reaction, sourceInstance, db) : null;
  if (localMsg && scopeRefusal) {
    console.warn(`[federation] Refused reaction_remove on message ${localMsg.id} (${scopeRefusal}): ${extractDomain(sourceInstance)} is not a peer of its conversation, or the reactor is not a member`);
    rejected.push({ messageId: event.messageId, reason: scopeRefusal });
    return;
  }

  if (!localMsg) {
    rejected.push({ messageId: event.messageId, reason: 'unknown_message' });
    return;
  }

  // The reactor is the local user that IS the attributed identity, matched on
  // homeUserId + homeInstance; see `resolveRelayActor`.
  const reactor = resolveRelayActor(event.reaction, db);
  if (reactor.kind === 'mismatch') {
    console.warn('[federation] Refused reaction_remove: the reactor homeUserId names a local user of another identity');
    rejected.push({ messageId: event.messageId, reason: 'attribution_mismatch' });
    return;
  }
  if (reactor.kind === 'unknown') {
    rejected.push({ messageId: event.messageId, reason: 'user_not_found' });
    return;
  }
  const reactingUser = reactor.user;

  const result = db
    .delete(schema.dmReactions)
    .where(
      and(
        eq(schema.dmReactions.dmMessageId, localMsg.id),
        eq(schema.dmReactions.userId, reactingUser.id),
        eq(schema.dmReactions.emoji, event.reaction.emoji),
      ),
    )
    .run();

  if (result.changes > 0) {
    connectionManager.sendToDmMembers(localMsg.dmChannelId, {
      type: 'reaction_removed',
      messageId: localMsg.id,
      userId: reactingUser.id,
      emoji: event.reaction.emoji,
    });
  }

  accepted.push(event.messageId);
}

// ─── Membership mutation processors ──────────────────────────────────────────
