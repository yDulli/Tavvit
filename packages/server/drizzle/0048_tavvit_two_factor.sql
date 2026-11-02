CREATE TABLE `known_devices` (
	`user_id` text NOT NULL,
	`device_hash` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `device_hash`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_known_devices_seen` ON `known_devices` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `mfa_tickets` (
	`ticket_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mfa_tickets_user` ON `mfa_tickets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mfa_tickets_expires` ON `mfa_tickets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`client_label` text,
	`address_hint` text,
	`count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_security_events_user` ON `security_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_security_events_created` ON `security_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `two_factor_recovery_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_two_factor_recovery_user` ON `two_factor_recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `two_factor_secrets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret_enc` text NOT NULL,
	`confirmed_at` integer,
	`last_used_step` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `two_factor_enabled_at` integer;