CREATE TABLE `space_emojis` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`animated` integer DEFAULT 0 NOT NULL,
	`size` integer NOT NULL,
	`discord_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_emojis_space_name_unique` ON `space_emojis` (`space_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `space_emojis_space_discord_unique` ON `space_emojis` (`space_id`,`discord_id`) WHERE discord_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_space_emojis_created_by` ON `space_emojis` (`created_by`);--> statement-breakpoint
CREATE TABLE `space_stickers` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`sticker_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`animated` integer DEFAULT 0 NOT NULL,
	`size` integer NOT NULL,
	`discord_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sticker_id`) REFERENCES `sticker_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_stickers_space_name_unique` ON `space_stickers` (`space_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `space_stickers_space_discord_unique` ON `space_stickers` (`space_id`,`discord_id`) WHERE discord_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_space_stickers_sticker` ON `space_stickers` (`sticker_id`);--> statement-breakpoint
CREATE INDEX `idx_space_stickers_created_by` ON `space_stickers` (`created_by`);--> statement-breakpoint
ALTER TABLE `spaces` ADD `discord_imported_at` integer;