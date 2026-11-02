CREATE TABLE `space_invites` (
	`code` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `space_invites_space_idx` ON `space_invites` (`space_id`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `emoji_policy` text DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `dm_policy` text DEFAULT 'friends_and_spaces' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `friend_request_policy` text DEFAULT 'anyone' NOT NULL;--> statement-breakpoint
INSERT INTO `space_invites` (`code`, `space_id`, `created_by`, `created_at`, `uses`)
  SELECT `invite_code`, `id`, `owner_id`, `created_at`, 0 FROM `spaces` WHERE `invite_code` IS NOT NULL;
