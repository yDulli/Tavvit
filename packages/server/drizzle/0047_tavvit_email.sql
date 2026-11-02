CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`priority` text NOT NULL,
	`user_id` text,
	`to_address` text,
	`to_hash` text NOT NULL,
	`locale` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`link_nonce` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`provider_id` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_email_outbox_due` ON `email_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_email_outbox_address` ON `email_outbox` (`to_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_email_outbox_user` ON `email_outbox` (`user_id`);--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`address_hash` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`address` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_email_tokens_user` ON `email_tokens` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `idx_email_tokens_expires` ON `email_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `email_usage_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`provider_day` integer,
	`provider_month` integer
);
--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `email_required_since` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `pending_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `locale` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_verified_email` ON `users` (`email`) WHERE email_verified_at IS NOT NULL;