CREATE TABLE `bot_commands` (
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	PRIMARY KEY(`bot_id`, `name`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`description` text,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bots_owner` ON `bots` (`owner_id`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `bots_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `bot_id` text;