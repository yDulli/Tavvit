CREATE TABLE `voice_overlays` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_overlays_token_hash_unique` ON `voice_overlays` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `voice_overlays_channel_user_unique` ON `voice_overlays` (`channel_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `spaces` ADD `tag` text;--> statement-breakpoint
ALTER TABLE `users` ADD `space_tag` text;