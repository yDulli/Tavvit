CREATE TABLE `space_sounds` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`mimetype` text NOT NULL,
	`size` integer NOT NULL,
	`duration` real NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_space_sounds_space` ON `space_sounds` (`space_id`);--> statement-breakpoint
UPDATE `roles` SET `permissions` = CAST(CAST(`permissions` AS INTEGER) | 134217728 AS TEXT) WHERE `id` = `space_id` AND `permissions` IS NOT NULL;
