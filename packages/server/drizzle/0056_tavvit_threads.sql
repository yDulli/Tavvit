CREATE TABLE `thread_members` (
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_thread_members_user` ON `thread_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `channels` ADD `parent_channel_id` text REFERENCES channels(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `channels` ADD `thread_starter_message_id` text REFERENCES messages(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `channels` ADD `thread_created_by` text;--> statement-breakpoint
CREATE INDEX `idx_channels_parent` ON `channels` (`parent_channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channels_thread_starter` ON `channels` (`thread_starter_message_id`) WHERE thread_starter_message_id IS NOT NULL;--> statement-breakpoint
UPDATE `roles` SET `permissions` = CAST(CAST(`permissions` AS INTEGER) | 131072 AS TEXT) WHERE `id` = `space_id` AND `permissions` IS NOT NULL;
