import type { SavedItem } from '@backspace/shared/src/saved.js';
import { withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  isSpaceDefaultNotificationLevel,
  resolveChannelNotificationPolicy,
  type DmMessageWithUser,
  type MessageWithUser,
} from '@backspace/shared';
import { emojiTokensToText } from '@backspace/shared/src/customEmoji.js';
import { splitMentions } from '@backspace/shared/src/mentions.js';
import { isMessageAlert } from '@backspace/shared/src/notificationRules.js';
import { PUSH_LIMITS, type PushPayload } from '@backspace/shared/src/push.js';
import { maskSpoilers } from '@backspace/shared/src/spoilers.js';
import { followedThreadLevel } from '@backspace/shared/src/threads.js';
import { threadFollowers, threadRowOf } from './threads.js';
import { stickerUrl } from '@backspace/shared/src/stickers.js';
import { getDb, schema } from '../db/index.js';
import { hasBlocked } from './blocks.js';
import { getOurOrigin } from './federationAuth.js';
import { computePermissions, PermissionBits } from './permissions.js';
import { activeSuspension } from './suspension.js';
import { generateVapidKeys, sendWebPush, type VapidKeys, type WebPushOptions } from './webPush.js';

/**
 * Who gets a push for what (docs/systems/push.md): the same rule as the sound and the
 * notification of an open client (`isMessageAlert`), read here from what the server holds,
 * for a person with a device and no window in front of them. Only accounts of this instance:
 * a device registers at its account's home. Nothing here throws into the path of a message.
 */

/** A second message in the same place within this time brings no second push. */
const SAME_PLACE_PAUSE_MS = 3_000;
const MESSAGE_OPTIONS: WebPushOptions = { ttl: 24 * 3600, urgency: 'high' };
const CALL_OPTIONS: WebPushOptions = { ttl: 30, urgency: 'high' };
const SENDING_AT_ONCE = 8;
/** A device that failed this many times in a row with no success is taken off. */
const FAILURES_MAX = 20;

type SubscriptionRow = typeof schema.pushSubscriptions.$inferSelect;
export type IsFocused = (userId: string) => boolean;

let vapidKeys: VapidKeys | null = null;

/** This instance's keys, made the first time they are needed. Losing them only asks each device to register again. */
export function getVapidKeys(): VapidKeys {
  if (vapidKeys) return vapidKeys;
  const db = getDb();
  db.insert(schema.pushKeys).values({ id: 1, ...generateVapidKeys(), createdAt: Date.now() }).onConflictDoNothing().run();
  const row = db.select().from(schema.pushKeys).get();
  if (!row) throw new Error('push_keys has no row after writing one');
  vapidKeys = { publicKey: row.publicKey, privateKey: row.privateKey };
  return vapidKeys;
}

/** For tests: forget the keys held in memory. */
export function _resetVapidKeys(): void {
  vapidKeys = null;
  recentPushes.clear();
}

const WORDS: Record<string, { reminder: string; voice: string; sticker: string; attachment: string; hidden: string; spoiler: string; call: string; eventSoon: string }> = {
  en: { reminder: 'Reminder', voice: 'Voice message', sticker: 'Sticker', attachment: 'Sent a file', hidden: 'New message', spoiler: '[spoiler]', call: 'is calling you', eventSoon: 'Starts soon' },
  de: { reminder: 'Erinnerung', voice: 'Sprachnachricht', sticker: 'Sticker', attachment: 'Hat eine Datei gesendet', hidden: 'Neue Nachricht', spoiler: '[Spoiler]', call: 'ruft dich an', eventSoon: 'Beginnt gleich' },
  pt: { reminder: 'Lembrete', voice: 'Mensagem de voz', sticker: 'Figurinha', attachment: 'Enviou um arquivo', hidden: 'Nova mensagem', spoiler: '[spoiler]', call: 'está ligando para você', eventSoon: 'Começa em breve' },
  ru: { reminder: 'Напоминание', voice: 'Голосовое сообщение', sticker: 'Стикер', attachment: 'Отправил(а) файл', hidden: 'Новое сообщение', spoiler: '[спойлер]', call: 'звонит вам', eventSoon: 'Скоро начнётся' },
  zh: { reminder: '提醒', voice: '语音消息', sticker: '贴纸', attachment: '发送了文件', hidden: '新消息', spoiler: '[剧透]', call: '正在呼叫你', eventSoon: '即将开始' },
};
const wordsFor = (locale: string | null) => WORDS[locale ?? 'en'] ?? WORDS.en!;

function displayNameOf(user: { displayName?: string | null; username: string }): string {
  // A notification shows a name as the characters it is (shared/src/profileFields.ts).
  return (user.displayName ? withoutUnsafeCharacters(user.displayName) : '') || user.username;
}

/** The message as one short line in the device's language: no ids, no marks, nothing a spoiler hides. */
export function pushBodyOf(
  content: string | null,
  attachmentCount: number,
  device: Pick<SubscriptionRow, 'showText' | 'locale'>,
  isVoice = false,
): string {
  const words = wordsFor(device.locale);
  if (!device.showText) return words.hidden;
  if (!content && isVoice) return words.voice;
  if (!content) return attachmentCount > 0 ? words.attachment : words.hidden;
  if (stickerUrl(content)) return words.sticker;
  const db = getDb();
  const plain = splitMentions(maskSpoilers(content, words.spoiler)).map((part) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'user': {
        const user = db.select({ username: schema.users.username, displayName: schema.users.displayName })
          .from(schema.users).where(eq(schema.users.id, part.userId)).get();
        return user ? `@${displayNameOf(user)}` : '@';
      }
      case 'role':
        return `@${db.select({ name: schema.roles.name }).from(schema.roles).where(eq(schema.roles.id, part.roleId)).get()?.name ?? ''}`;
      case 'everyone':
        return `@${part.keyword}`;
    }
  }).join('');
  const text = emojiTokensToText(plain).replace(/[*_~`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return words.hidden;
  return text.length > PUSH_LIMITS.BODY_MAX_LENGTH ? `${text.slice(0, PUSH_LIMITS.BODY_MAX_LENGTH - 1)}…` : text;
}

interface Delivery {
  device: SubscriptionRow;
  payload: PushPayload;
  options: WebPushOptions;
}

const waiting: Delivery[] = [];
let sendingNow = 0;

function pump(): void {
  while (sendingNow < SENDING_AT_ONCE && waiting.length > 0) {
    const next = waiting.shift()!;
    sendingNow += 1;
    void deliver(next).finally(() => {
      sendingNow -= 1;
      pump();
    });
  }
}

async function deliver({ device, payload, options }: Delivery): Promise<void> {
  const outcome = await sendWebPush(device, payload, getVapidKeys(), getOurOrigin(), options);
  const db = getDb();
  const rows = eq(schema.pushSubscriptions.id, device.id);
  if (outcome === 'sent') {
    db.update(schema.pushSubscriptions).set({ lastSuccessAt: Date.now(), failures: 0 }).where(rows).run();
  } else if (outcome === 'gone' || device.failures + 1 >= FAILURES_MAX) {
    db.delete(schema.pushSubscriptions).where(rows).run();
  } else {
    db.update(schema.pushSubscriptions).set({ failures: sql`${schema.pushSubscriptions.failures} + 1` }).where(rows).run();
  }
}

const recentPushes = new Map<string, number>();

function pausedForPlace(userId: string, tag: string, now: number): boolean {
  const key = `${userId}:${tag}`;
  const last = recentPushes.get(key);
  if (last !== undefined && now - last < SAME_PLACE_PAUSE_MS) return true;
  if (recentPushes.size > 5_000) {
    for (const [entry, at] of recentPushes) {
      if (now - at >= SAME_PLACE_PAUSE_MS) recentPushes.delete(entry);
    }
  }
  recentPushes.set(key, now);
  return false;
}

/** Whether this account can get anything right now, whatever the message. */
function reachable(userId: string, now: number, isFocused: IsFocused): boolean {
  if (isFocused(userId)) return false;
  const user = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || user.isDeleted === 1 || user.homeInstance) return false;
  if (user.chosenStatus === 'dnd') return false;
  return activeSuspension(user, now) === null;
}

function queueForUser(
  devices: readonly SubscriptionRow[],
  build: (device: SubscriptionRow) => PushPayload,
  options: WebPushOptions,
): void {
  for (const device of devices) waiting.push({ device, payload: build(device), options });
  pump();
}

function devicesByUser(userIds: readonly string[]): Map<string, SubscriptionRow[]> {
  const byUser = new Map<string, SubscriptionRow[]>();
  if (userIds.length === 0) return byUser;
  const rows = getDb().select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, [...userIds])).all();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  return byUser;
}

/** A message in a space channel. */
function pushChannelMessageNow(spaceId: string, message: MessageWithUser, isFocused: IsFocused): void {
  if (message.type === 'system') return;
  const db = getDb();
  const thread = threadRowOf(message.channelId);
  const followers = thread ? new Set(threadFollowers(thread.id)) : null;
  const settingsChannelId = thread?.parentChannelId ?? message.channelId;
  const candidates = db.selectDistinct({ userId: schema.pushSubscriptions.userId })
    .from(schema.pushSubscriptions)
    .innerJoin(schema.spaceMembers, and(
      eq(schema.spaceMembers.userId, schema.pushSubscriptions.userId),
      eq(schema.spaceMembers.spaceId, spaceId),
    ))
    .all()
    .map((row) => row.userId)
    .filter((userId) => userId !== message.userId && (!followers || followers.has(userId)));
  if (candidates.length === 0) return;

  const space = db.select({ level: schema.spaces.defaultNotificationLevel }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  const spaceDefault = isSpaceDefaultNotificationLevel(space?.level) ? space.level : null;
  const channelName = db.select({ name: schema.channels.name }).from(schema.channels).where(eq(schema.channels.id, message.channelId)).get()?.name ?? '';
  const now = Date.now();
  const tag = `channel:${message.channelId}`;
  const devices = devicesByUser(candidates);

  for (const userId of candidates) {
    if (!reachable(userId, now, isFocused)) continue;
    if (hasBlocked(userId, message.userId)) continue;
    const permissions = computePermissions(userId, spaceId, message.channelId);
    if ((permissions & PermissionBits.VIEW_CHANNEL) === 0n && (permissions & PermissionBits.ADMINISTRATOR) === 0n) continue;

    const settings = db.select().from(schema.notificationSettings)
      .where(and(eq(schema.notificationSettings.userId, userId), eq(schema.notificationSettings.spaceId, spaceId)))
      .all();
    const toSetting = (row: (typeof settings)[number] | undefined) => (row ? {
      spaceId,
      channelId: row.channelId ?? null,
      level: row.level as 'all' | 'mentions' | 'nothing' | null,
      muted: row.muted === 1,
      mutedUntil: row.muted === 1 ? row.mutedUntil ?? null : null,
      suppressEveryone: row.suppressEveryone === 1,
      suppressRoles: row.suppressRoles === 1,
      updatedAt: row.updatedAt,
    } : null);
    const channelPolicy = resolveChannelNotificationPolicy(
      toSetting(settings.find((row) => row.channelId === null)),
      toSetting(settings.find((row) => row.channelId === settingsChannelId)),
      now,
      spaceDefault,
    );
    const policy = thread ? followedThreadLevel(channelPolicy) : channelPolicy;
    const myRoleIds = db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.spaceId, spaceId), eq(schema.memberRoles.userId, userId)))
      .all()
      .map((row) => row.roleId);
    const keywords = db.select({ word: schema.notificationKeywords.word }).from(schema.notificationKeywords)
      .where(eq(schema.notificationKeywords.userId, userId))
      .all()
      .map((row) => row.word);
    const alerts = isMessageAlert({
      authoredBySelf: false,
      isDmChannel: false,
      allChannels: false,
      myId: userId,
      myRoleIds,
      keywords,
      content: message.content,
      mentionEveryone: message.mentionEveryone,
      mentionRoleIds: message.mentionRoleIds,
      notification: policy,
    });
    if (!alerts || pausedForPlace(userId, tag, now)) continue;

    queueForUser(devices.get(userId) ?? [], (device) => ({
      title: `${displayNameOf(message.user)} · #${channelName}`,
      body: pushBodyOf(message.content, message.attachments?.length ?? 0, device, message.attachments?.some((attachment) => Boolean(attachment.voiceWaveform))),
      tag,
      url: thread
        ? `/channels/${spaceId}/${thread.parentChannelId}?thread=${thread.id}&message=${message.id}`
        : `/channels/${spaceId}/${message.channelId}?message=${message.id}`,
    }), MESSAGE_OPTIONS);
  }
}

/** A message in a conversation. It comes here also when a peer relayed it. */
function pushDmMessageNow(message: DmMessageWithUser, isFocused: IsFocused): void {
  if (message.type === 'system') return;
  const db = getDb();
  const members = db.select({ userId: schema.dmMembers.userId }).from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, message.dmChannelId))
    .all()
    .map((row) => row.userId)
    .filter((userId) => userId !== message.userId);
  if (members.length === 0) return;
  const devices = devicesByUser(members);
  if (devices.size === 0) return;
  const now = Date.now();
  const tag = `dm:${message.dmChannelId}`;

  for (const [userId, own] of devices) {
    if (!reachable(userId, now, isFocused)) continue;
    if (hasBlocked(userId, message.userId)) continue;
    const wanting = own.filter((device) => device.directMessages);
    if (wanting.length === 0 || pausedForPlace(userId, tag, now)) continue;
    queueForUser(wanting, (device) => ({
      title: displayNameOf(message.user),
      body: pushBodyOf(message.content, message.attachments?.length ?? 0, device, message.attachments?.some((attachment) => Boolean(attachment.voiceWaveform))),
      tag,
      url: `/channels/@me/${message.dmChannelId}?message=${message.id}`,
    }), MESSAGE_OPTIONS);
  }
}

/** A conversation's call starting to ring. It says only who, and is gone soon. */
function pushDmCallNow(dmChannelId: string, callerId: string, callerName: string, isFocused: IsFocused): void {
  const db = getDb();
  const members = db.select({ userId: schema.dmMembers.userId }).from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, dmChannelId))
    .all()
    .map((row) => row.userId)
    .filter((userId) => userId !== callerId);
  const devices = devicesByUser(members);
  const now = Date.now();
  for (const [userId, own] of devices) {
    if (!reachable(userId, now, isFocused)) continue;
    if (hasBlocked(userId, callerId)) continue;
    queueForUser(own, (device) => ({
      title: callerName,
      body: wordsFor(device.locale).call,
      tag: `call:${dmChannelId}`,
      url: `/channels/@me/${dmChannelId}`,
    }), CALL_OPTIONS);
  }
}

/** A saved message someone asked to be reminded of. */
function pushSavedReminderNow(userId: string, item: SavedItem, isFocused: IsFocused): void {
  if (!reachable(userId, Date.now(), isFocused)) return;
  const { content, attachments } = item.message;
  const isVoice = (attachments ?? []).some((attachment) => Boolean(attachment.voiceWaveform));
  queueForUser(devicesByUser([userId]).get(userId) ?? [], (device) => ({
    title: wordsFor(device.locale).reminder,
    body: pushBodyOf(content, attachments?.length ?? 0, device, isVoice),
    tag: `saved:${item.id}`,
    url: item.kind === 'channel'
      ? `/channels/${item.spaceId}/${item.channelId}?message=${item.message.id}`
      : `/channels/@me/${item.channelId}?message=${item.message.id}`,
  }), MESSAGE_OPTIONS);
}

/** An event someone is going to starts soon. */
function pushEventReminderNow(event: { id: string; spaceId: string; title: string }, userIds: readonly string[], isFocused: IsFocused): void {
  const devices = devicesByUser(userIds);
  const now = Date.now();
  for (const [userId, own] of devices) {
    if (!reachable(userId, now, isFocused)) continue;
    queueForUser(own, (device) => ({
      title: event.title,
      body: wordsFor(device.locale).eventSoon,
      tag: `event:${event.id}`,
      url: `/channels/${event.spaceId}/events`,
    }), MESSAGE_OPTIONS);
  }
}

/** After the message's own path: a failure here is logged and goes no further. */
function later(work: () => void): void {
  setImmediate(() => {
    try {
      work();
    } catch (err) {
      console.error('[push] could not work out who to tell:', err);
    }
  });
}

export function pushChannelMessage(spaceId: string, message: MessageWithUser, isFocused: IsFocused): void {
  later(() => pushChannelMessageNow(spaceId, message, isFocused));
}

export function pushDmMessage(message: DmMessageWithUser, isFocused: IsFocused): void {
  later(() => pushDmMessageNow(message, isFocused));
}

export function pushSavedReminder(userId: string, item: SavedItem, isFocused: IsFocused): void {
  later(() => pushSavedReminderNow(userId, item, isFocused));
}

export function pushEventReminder(event: { id: string; spaceId: string; title: string }, userIds: readonly string[], isFocused: IsFocused): void {
  later(() => pushEventReminderNow(event, userIds, isFocused));
}

export function pushDmCall(dmChannelId: string, callerId: string, callerName: string, isFocused: IsFocused): void {
  later(() => pushDmCallNow(dmChannelId, callerId, callerName, isFocused));
}

/** For tests: the work of `later`, at once. */
export const _forTests = { pushEventReminderNow, pushChannelMessageNow, pushDmMessageNow, pushDmCallNow };
