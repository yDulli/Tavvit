CREATE TABLE `admin_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_admin_notes_user` ON `admin_notes` (`user_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`tone` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`ends_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_announcements_live` ON `announcements` (`ended_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `signup_rules` (
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `value`)
);
--> statement-breakpoint
CREATE TABLE `starter_spaces` (
	`space_id` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
