CREATE TABLE `poll_options` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_poll_options_message` ON `poll_options` (`message_id`);--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`option_id` text NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`option_id`, `user_id`),
	FOREIGN KEY (`option_id`) REFERENCES `poll_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_poll_votes_message` ON `poll_votes` (`message_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_poll_votes_user` ON `poll_votes` (`user_id`);--> statement-breakpoint
CREATE TABLE `polls` (
	`message_id` text PRIMARY KEY NOT NULL,
	`multiple` integer DEFAULT false NOT NULL,
	`ends_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
