CREATE TABLE `channel_slowmode_posts` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`posted_at` integer NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `space_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	`changes` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_space_audit_log_space_page` ON `space_audit_log` (`space_id`,CAST(id AS INTEGER));--> statement-breakpoint
CREATE INDEX `idx_space_audit_log_space_created` ON `space_audit_log` (`space_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `space_departed_timeouts` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`timed_out_until` integer NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `space_moderation_settings` (
	`space_id` text PRIMARY KEY NOT NULL,
	`blocked_words` text DEFAULT '[]' NOT NULL,
	`block_links` integer DEFAULT 0 NOT NULL,
	`block_invites` integer DEFAULT 0 NOT NULL,
	`max_mentions` integer DEFAULT 0 NOT NULL,
	`min_account_age_minutes` integer DEFAULT 0 NOT NULL,
	`min_member_age_minutes` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `channels` ADD `slowmode_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `space_members` ADD `timed_out_until` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `default_notification_level` text;