CREATE TABLE `operator_alerts` (
	`cause` text PRIMARY KEY NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`detail` text,
	`since` integer NOT NULL,
	`last_mailed_at` integer
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `on_status_page` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `recent_starts` text;