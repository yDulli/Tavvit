ALTER TABLE `roles` ADD `description` text;--> statement-breakpoint
ALTER TABLE `roles` ADD `color_secondary` text;--> statement-breakpoint
ALTER TABLE `roles` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `roles` ADD `hoist` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `mentionable` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `space_members` ADD `avatar` text;--> statement-breakpoint
ALTER TABLE `space_members` ADD `banner` text;--> statement-breakpoint
ALTER TABLE `space_members` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `owner_group` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pronouns` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_links` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_layout` text;--> statement-breakpoint
-- A space whose owner named the owner group keeps that group; every other
-- space lists its owner under their own roles, marked by a crown.
UPDATE `spaces` SET `owner_group` = 1 WHERE `owner_title` IS NOT NULL;
