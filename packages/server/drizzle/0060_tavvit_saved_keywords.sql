CREATE TABLE `notification_keywords` (
	`user_id` text NOT NULL,
	`word` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `word`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text,
	`dm_message_id` text,
	`remind_at` integer,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dm_message_id`) REFERENCES `dm_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_saved_user_message` ON `saved_messages` (`user_id`,`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_saved_user_dm_message` ON `saved_messages` (`user_id`,`dm_message_id`);--> statement-breakpoint
CREATE INDEX `idx_saved_due` ON `saved_messages` (`remind_at`) WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL;