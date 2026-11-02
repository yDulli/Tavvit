CREATE TABLE `retired_usernames` (
	`username` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`until` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `username_changed_at` integer;