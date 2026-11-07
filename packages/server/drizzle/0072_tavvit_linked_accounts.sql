CREATE TABLE `linked_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`login` text NOT NULL,
	`display_name` text NOT NULL,
	`show_on_profile` integer DEFAULT 1 NOT NULL,
	`show_live` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linked_accounts_user_provider_unique` ON `linked_accounts` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `linked_accounts_provider_account_unique` ON `linked_accounts` (`provider`,`provider_user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `profile_linked_accounts` text;