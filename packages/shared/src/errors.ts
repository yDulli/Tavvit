/**
 * Stable error codes shared by the server and every client.
 *
 * The server never localizes. It sends one of these codes alongside an
 * English `error` string, and the client that shows the message owns the
 * words. The English text exists for logs and for clients that predate the
 * code; the code exists so a Russian or German client can say it properly.
 *
 * Codes are snake_case identifiers and never change meaning once shipped:
 * the desktop app, the web client and every federated peer version
 * independently, and an old client that meets a new code falls back to the
 * English text, so removing or repurposing one is a wire-protocol break.
 *
 * Adding a code: append it here, give it English text in
 * `packages/server/src/utils/httpErrors.ts`, and give it a message in every
 * `packages/web/src/locales/<lng>/errors.json`. The i18n consistency check
 * fails when a code has no catalog entry.
 */
export const ERROR_CODES = [
  // Generic
  'not_found',
  'forbidden',
  'unauthorized',
  'validation_failed',
  'rate_limited',

  // Auth and accounts
  'username_required',
  'password_required',
  'username_invalid',
  'username_too_long',
  'username_taken',
  'password_too_short',
  'password_too_long',
  'password_too_common',
  'cannot_delete_admin',
  'last_admin_cannot_leave',
  'email_domain_blocked',
  'username_reserved',
  'announcement_limit',
  'backup_too_soon',
  'starter_spaces_limit',
  'signup_rule_invalid',
  'signup_rule_limit',
  'invalid_credentials',
  'registration_closed',
  'invite_required',
  'invite_invalid',
  'current_password_incorrect',
  'password_unchanged',
  'display_name_too_long',
  'bio_too_long',
  'custom_status_too_long',
  'custom_status_expiry_invalid',
  'profile_managed_by_home',
  'account_deletion_blocked_owned_spaces',
  'account_deletion_password_incorrect',

  // Mail (docs/systems/email.md)
  'email_not_configured',
  'email_unavailable',
  'email_invalid',
  'email_required',
  'email_undeliverable',
  'email_token_invalid',
  'email_address_in_use',
  'email_nothing_to_confirm',
  'email_verification_required',

  // Two-factor authentication
  'mfa_required',
  'mfa_code_required',
  'mfa_code_invalid',
  'mfa_ticket_invalid',
  'mfa_locked',
  'two_factor_unavailable',
  'two_factor_already_enabled',
  'two_factor_not_enabled',

  // Social
  'cannot_friend_self',
  'user_not_found',
  'already_friends',
  'incoming_request_exists',
  'invalid_target_domain',
  'lookup_rate_limited',
  'not_authoritative_for_sender',

  // Blocking
  'blocked_by_you',
  'interaction_unavailable',
  'cannot_block_self',

  // Platform administration (platform.ts): suspensions, badges, reviews, finding people
  // details: { reason, until? }
  'account_suspended',
  'cannot_suspend_self',
  'cannot_suspend_admin',
  // details: { min, max }
  'suspension_reason_invalid',
  // details: { max }
  'suspension_duration_invalid',
  'user_not_suspended',
  'badge_invalid',
  'review_category_invalid',
  // details: { min, max }
  'review_reason_invalid',
  // details: { min, max }
  'review_proof_invalid',
  // details: { max }
  'review_url_invalid',
  // details: { max }
  'review_too_many_profiles',
  'review_note_required',
  // details: { max }
  'review_note_too_long',
  'review_status_conflict',
  'review_already_verified',
  'review_decision_invalid',
  'discovery_requires_listable_visibility',
  'discovery_requires_description',
  'discovery_requires_uploaded_pictures',
  // details: { min, max }
  'user_search_query_invalid',

  // Legal documents, reports and notices (legal.ts)
  'terms_not_accepted',
  'age_not_confirmed',
  'dm_not_accepted',
  'friend_request_not_accepted',
  'emoji_admins_only',
  'invite_options_invalid',
  'invite_limit_reached',
  'moderation_reason_too_long',
  'ban_delete_window_invalid',
  'session_ended',
  'too_many_connections',
  'reaction_limit_reached',
  'data_export_too_soon',
  'data_export_not_ready',
  'terms_version_invalid',
  'legal_operator_invalid',
  'legal_operator_required',
  'legal_document_invalid',
  'legal_document_too_long',
  'legal_document_not_found',
  'legal_effective_date_invalid',
  'legal_changes_required',
  'report_category_invalid',
  'report_explanation_invalid',
  'report_good_faith_required',
  'report_target_invalid',
  'report_target_not_found',
  'report_contact_required',
  'report_duplicate',
  'report_not_found',
  'report_already_decided',
  'report_decision_invalid',
  'report_note_required',
  'report_ground_required',
  'notice_not_found',

  // Profile images
  'profile_image_invalid',
  'profile_image_too_large',

  // Custom emoji
  'emoji_name_invalid',
  'emoji_name_taken',
  'emoji_image_invalid',
  'emoji_image_too_large',
  'emoji_limit_reached',
  'emoji_not_found',

  // Federation and peering
  'peer_rejected',
  'peer_pending',
  'peer_pending_approval',
  'peer_pending_local_admin',
  'peer_unreachable',
  'PEER_EXISTS_RESET_REQUIRED',
  'PEER_REVOKED',
  'PEER_HANDSHAKE_IN_PROGRESS',

  // Direct messages
  'recipient_deleted',

  // auth-users
  'username_length_invalid',
  'username_characters_invalid',
  'home_instance_invalid',
  'home_instance_unproven',
  'username_local_part_invalid',
  'username_domain_part_invalid',
  'replicated_username_format_required',
  'federated_registration_closed',
  'user_create_failed',
  'account_deleted',
  'target_domain_required',
  'native_account_required',
  'reattach_handle_taken',
  'username_confirmation_required',
  'username_confirmation_mismatch',
  'avatar_url_invalid',
  'banner_url_invalid',
  'accent_color_invalid',
  'avatar_color_invalid',
  'status_invalid',
  'no_fields_to_update',
  'registry_conflict',
  'origin_required',
  'origin_invalid',
  'federation_credential_remote_only',
  'federation_credential_home_only',
  'federation_credential_failed',
  // Minted by the client, not by a route: the remote account refused the
  // credential this user's home instance issued for it, so the only way in
  // is the password that account holds of its own.
  'federation_different_password',
  // dm
  'peer_reset_pending',
  'dm_target_required',
  'cannot_dm_self',
  'group_dm_too_few_members',
  'group_dm_too_many_members',
  'group_dm_limit_reached',
  'group_dm_member_limit_reached',
  'users_not_found',
  'duplicate_users',
  'group_dm_includes_self',
  'not_a_friend',
  'dm_not_found',
  'dm_not_group',
  'not_dm_member',
  'dm_owner_only',
  'group_dm_name_length',
  'icon_url_invalid',
  'attachment_not_found',
  'attachment_not_owned',
  'icon_not_image',
  'icon_too_large',
  'already_member',
  'owner_cannot_kick_self',
  'target_not_dm_member',
  'new_owner_required',
  'already_owner',
  'invalid_body',
  'invalid_target',
  'cannot_invite_self',
  // Sent up to 1.9.0 by POST /api/dm/space-invite for a local request space.
  // A current server sends that invite; an older home still refuses it.
  'space_requires_approval',
  'message_lookup_failed',
  // admin-settings
  'field_not_boolean',
  'instance_settings_missing',
  'instance_settings_reload_failed',
  'instance_name_length',
  'upload_limit_out_of_range',
  'account_limit_out_of_range',
  'storage_limit_reached',
  'upload_too_large',
  'cards_invalid',
  'cards_not_allowed',
  'interaction_not_found',
  'command_option_invalid',
  'space_limit_reached',
  'disk_full',
  'relay_ttl_out_of_range',
  'rotation_interval_out_of_range',
  'streaming_max_bitrate_out_of_range',
  'streaming_min_bitrate_out_of_range',
  'streaming_bitrate_step_out_of_range',
  'streaming_min_bitrate_not_below_max',
  'streaming_resolutions_required',
  'streaming_resolutions_invalid',
  'streaming_framerates_required',
  'streaming_framerates_invalid',
  'streaming_max_resolution_invalid',
  'streaming_max_framerate_invalid',
  'streaming_bitrate_matrix_invalid',
  'streaming_bitrate_matrix_key_invalid',
  'streaming_bitrate_matrix_value_invalid',
  'storage_stats_failed',
  'storage_orphans_failed',
  'storage_cleanup_failed',
  'media_cleanup_failed',
  'upload_session_cleanup_failed',
  'cleanup_age_invalid',
  'deleted_user_role_change',
  'deleted_user_password_reset',
  'user_already_deleted',
  'federated_user_cannot_be_admin',
  'federated_user_password_managed_by_home',
  'last_admin_cannot_be_demoted',
  'admin_cannot_delete_self',
  'user_owns_spaces',
  // social-explore
  'friend_request_pending',
  'friend_request_not_found',
  'friend_request_not_recipient',
  'friend_request_not_sender',
  'friend_request_not_pending',
  'not_friends',
  'lookup_failed',
  'space_not_found',
  'space_not_public',
  'space_not_requestable',
  'space_load_failed',
  'user_banned',
  'missing_permission',
  'join_request_pending',
  'join_request_not_found',
  'join_request_decided',
  // spaces
  'space_owner_title_invalid',
  'member_nickname_invalid',
  'space_name_required',
  'space_name_length',
  'space_create_failed',
  'not_space_member',
  'space_visibility_invalid',
  'space_update_failed',
  'space_owner_only',
  // Sent up to 1.9.0 by POST /api/spaces/:id/invite for a request space. A
  // current server hands that space its link; an older peer still sends it.
  'space_uses_join_requests',
  'invite_code_required',
  'invite_not_found',
  // An invite code used on a request space. `details.spaceId` names the space
  // to send `POST /api/spaces/:id/request-join` to (absent up to 1.9.0).
  'join_request_required',
  'cannot_change_own_roles',
  'role_ids_invalid',
  'member_not_found',
  'role_not_in_space',
  'everyone_role_not_assignable',
  'member_update_failed',
  'space_owner_cannot_leave',
  'cannot_target_owner',
  'cannot_target_self',
  'role_hierarchy',
  'permissions_invalid',
  'role_permissions_conflict',
  'role_name_taken',
  'role_name_required',
  'everyone_role_not_deletable',
  'new_owner_not_member',
  'ownership_transfer_failed',
  'user_id_required',
  'already_banned',
  'ban_not_found',
  // channels-messages
  'channel_not_found',
  'category_not_found',
  'message_not_found',
  'channel_name_required',
  'channel_name_length',
  'channel_topic_invalid',
  'channel_topic_length',
  'channel_type_invalid',
  'category_not_in_space',
  'channel_not_in_space',
  'position_invalid',
  'override_target_invalid',
  'override_target_required',
  'override_bits_invalid',
  'overrides_conflict',
  'cannot_grant_unowned_permissions',
  'cannot_deny_unowned_permissions',
  'cannot_change_unowned_permissions',
  'category_name_required',
  'category_name_length',
  'layout_arrays_required',
  'message_empty',
  'content_required',
  'content_too_long',
  'reply_target_invalid',
  'attachment_invalid',
  'message_create_failed',
  'message_update_failed',
  'not_message_author',
  'system_message_immutable',
  'message_edit_not_author',
  'message_delete_forbidden',
  'pin_limit_reached',
  'poll_ended',
  'poll_not_editable',
  'thread_not_allowed',
  'bots_disabled',
  'bot_token_invalid',
  'bot_owner_suspended',
  'bot_route_forbidden',
  'bot_not_found',
  'bot_limit_reached',
  'bot_banned',
  'bot_already_member',
  'bot_admin_forbidden',
  'bot_command_not_found',
  'bot_offline',
  'sound_not_found',
  'sound_limit_reached',
  'sound_too_large',
  'sound_too_long',
  'sound_invalid',
  'sound_not_in_call',
  'watch_not_in_call',
  'watch_link_unsupported',
  'watch_queue_full',
  'watch_not_controller',
  'watch_not_found',
  'saved_limit_reached',
  'keyword_limit_reached',
  'webhook_not_found',
  'webhook_not_allowed',
  'webhook_limit_reached',
  'event_not_found',
  'event_limit_reached',
  'rules_not_accepted',
  'signup_challenge_failed',
  'poke_target_no_access',
  'paging_cursor_conflict',
  'internal_error',
  // misc
  'voice_disabled',
  'voice_connect_forbidden',
  'dm_call_in_progress',
  'dm_call_not_found',
  'file_not_found',

  // Directory
  'directory_disabled',
  'directory_unreachable',
  'directory_private_space',
  'directory_requires_discovery',

  // Personal stickers
  'sticker_invalid_image',
  'sticker_not_local',
  'sticker_not_found',
  'sticker_elsewhere',
  'sticker_collection_full',
  'sticker_name_invalid',

  // Tavvit
  'federation_disabled',
  'accent_color_low_contrast',
  'login_throttled',

  // Space moderation (Server settings → Moderation; docs/systems/spaces.md)
  'automod_blocked_word',
  'automod_link_blocked',
  'automod_invite_blocked',
  // details: { max }
  'automod_too_many_mentions',
  'account_too_new',
  'membership_too_new',
  // details: { until } (epoch ms, the server's clock)
  'member_timed_out',
  // details: { retryAfterSeconds }
  'slowmode_active',
  'slowmode_invalid',
  'timeout_duration_invalid',
  // details: { max }
  'timeout_reason_too_long',
  // details: { field }
  'moderation_settings_invalid',
  'notification_level_invalid',

  // Roles (docs/systems/permissions.md, "Role display")
  'role_color_invalid',
  // details: { max }
  'role_description_too_long',
  'role_icon_invalid',
  // details: { max }
  'role_name_too_long',
  'role_name_invalid',

  // Profile cards
  // details: { max }
  'pronouns_too_long',
  // details: { max }
  'profile_links_invalid',
  'profile_layout_invalid',

  // Discord template import (docs/systems/spaces.md, "Importing a Discord template")
  'discord_template_code_invalid',
  'discord_template_not_found',
  // details: { retryAfterSeconds }
  'discord_rate_limited',
  'discord_unreachable',
  // details: { field }
  'discord_template_invalid',
  // details: { max } (megabytes)
  'discord_template_too_large',
  // details: { max }
  'discord_template_too_many_roles',
  // details: { max }
  'discord_template_too_many_channels',
  // details: { max }
  'discord_template_too_many_overwrites',
  'import_target_forbidden',

  // Importing a Discord server's emoji and stickers (docs/systems/spaces.md)
  'discord_server_id_invalid',
  'discord_bot_token_invalid',
  'discord_bot_not_in_server',
  'discord_import_expired',
  'discord_import_running',

  // A space's emoji and stickers (docs/systems/emoji.md)
  // details: { max }
  'space_emoji_limit_reached',
  // details: { max }
  'space_sticker_limit_reached',
  'space_emoji_name_taken',
  'space_sticker_name_taken',
  'space_emoji_not_found',
  'space_sticker_not_found',
  // A space's emoji used outside its space by someone who is not its member.
  'emoji_unavailable',
  // A forum holds posts, not messages of its own.
  'forum_takes_posts',
  'forum_required',
  // details: { max }
  'forum_tag_limit_reached',
  // details: { max }
  'forum_tag_name_length',
  'forum_tag_duplicate',
  'forum_tag_unknown',
  // details: { max }
  'forum_post_tag_limit',
  'forum_post_title_invalid',
  'announcement_channel_required',
  'follow_target_invalid',
  'follow_source_private',
  'follow_exists',
  'follow_not_found',
  // details: { max }
  'follow_limit_reached',
  'channel_type_change_invalid',
  // details: { min, max }
  'vanity_code_invalid',
  'vanity_code_taken',
  'vanity_code_reserved',
  'vanity_code_not_found',
  'translation_unavailable',
  'translation_failed',
  'translation_limit_reached',
  'linked_account_unavailable',
  'linked_account_home_only',
  'linked_account_expired',
  'linked_account_other_account',
  'linked_account_taken',
  'linked_account_failed',
  'linked_account_not_found',
  'username_same',
  'username_change_home_only',
  'username_change_connected',
  'username_change_too_soon',
  'channel_icon_invalid',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/** Interpolation values for the localized message, e.g. `{ max: 32 }`. */
export type ErrorDetails = Record<string, string | number>;

/**
 * The body of every non-2xx JSON response.
 *
 * `error` is always present. `code` and `details` are optional because
 * routes are converted to codes surface by surface, and because a federated
 * peer may run a version that has never heard of them.
 */
export interface ApiErrorBody {
  error: string;
  statusCode: number;
  code?: ErrorCode;
  details?: ErrorDetails;
}
