CREATE TABLE `blocked_vanity_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `channel_follows` (
	`id` text PRIMARY KEY NOT NULL,
	`source_channel_id` text NOT NULL,
	`target_channel_id` text NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channel_follows_pair` ON `channel_follows` (`source_channel_id`,`target_channel_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_follows_target` ON `channel_follows` (`target_channel_id`);--> statement-breakpoint
CREATE TABLE `forum_post_tags` (
	`thread_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`thread_id`, `tag_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `forum_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_forum_post_tags_tag` ON `forum_post_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `forum_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_forum_tags_channel` ON `forum_tags` (`channel_id`);--> statement-breakpoint
ALTER TABLE `spaces` ADD `vanity_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_vanity_code_unique` ON `spaces` (`vanity_code`);