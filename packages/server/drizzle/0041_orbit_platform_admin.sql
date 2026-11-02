CREATE TABLE `platform_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_label` text,
	`reason` text,
	`details` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_platform_audit_log_page` ON `platform_audit_log` (CAST(id AS INTEGER));--> statement-breakpoint
CREATE INDEX `idx_platform_audit_log_target` ON `platform_audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `space_discovery_requests` (
	`space_id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`approved_snapshot` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `space_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`process` text NOT NULL,
	`action` text NOT NULL,
	`status` text,
	`actor_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_space_review_events_space` ON `space_review_events` (`space_id`,`process`,`created_at`);--> statement-breakpoint
CREATE TABLE `space_verification_requests` (
	`space_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`website` text,
	`profiles` text DEFAULT '[]' NOT NULL,
	`reason` text NOT NULL,
	`proof` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `spaces` ADD `badges` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `verification_status` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `discovery_status` text;--> statement-breakpoint
ALTER TABLE `users` ADD `badges` text;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_until` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `suspension_reason` text;--> statement-breakpoint
-- Discovery approval (docs/systems/admin.md): a space listed before approvals
-- existed goes into review rather than staying listed or being dropped. Its
-- visibility and its directory opt-in are kept; it is hidden until an admin
-- approves it, and the owner can name its category by sending the request
-- again.
UPDATE `spaces` SET `discovery_status` = 'pending' WHERE `visibility` IN ('public', 'request');--> statement-breakpoint
INSERT INTO `space_discovery_requests` (`space_id`, `category`, `requested_by`, `requested_at`)
  SELECT `id`, 'other', `owner_id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM `spaces` WHERE `discovery_status` = 'pending';--> statement-breakpoint
INSERT INTO `space_review_events` (`id`, `space_id`, `process`, `action`, `status`, `actor_id`, `note`, `created_at`)
  SELECT 'migrated:' || `id`, `id`, 'discovery', 'migrated', 'pending', `owner_id`, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM `spaces` WHERE `discovery_status` = 'pending';--> statement-breakpoint
-- The served directory document shrinks; the dirty flag has the pinger tell the hub on boot.
UPDATE `instance_settings` SET `directory_dirty` = 1;