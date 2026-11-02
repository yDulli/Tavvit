CREATE TABLE `custom_emojis` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`animated` integer DEFAULT 0 NOT NULL,
	`size` integer NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_emojis_name_unique` ON `custom_emojis` (`name`);--> statement-breakpoint
CREATE INDEX `idx_custom_emojis_created_by` ON `custom_emojis` (`created_by`);