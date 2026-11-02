ALTER TABLE `dm_messages` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `dm_messages` ADD `pinned_by` text;--> statement-breakpoint
ALTER TABLE `dm_messages` ADD `pin_changed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_dm_messages_channel_pinned` ON `dm_messages` (`dm_channel_id`,`pinned_at`) WHERE pinned_at IS NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_by` text;--> statement-breakpoint
CREATE INDEX `idx_messages_channel_pinned` ON `messages` (`channel_id`,`pinned_at`) WHERE pinned_at IS NOT NULL;