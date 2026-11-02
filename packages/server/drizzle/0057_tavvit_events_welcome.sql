CREATE TABLE `space_event_rsvps` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `space_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_space_event_rsvps_user` ON `space_event_rsvps` (`user_id`);--> statement-breakpoint
CREATE TABLE `space_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`channel_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`created_by` text,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_space_events_space` ON `space_events` (`space_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_space_events_due` ON `space_events` (`starts_at`) WHERE reminder_sent_at IS NULL;--> statement-breakpoint
ALTER TABLE `space_members` ADD `rules_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `welcome_text` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `rules_text` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `rules_required_since` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `welcome_channel_ids` text;