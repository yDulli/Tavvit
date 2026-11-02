CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_webhooks_channel` ON `webhooks` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_webhooks_space` ON `webhooks` (`space_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `account_kind` text DEFAULT 'person' NOT NULL;