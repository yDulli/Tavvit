CREATE TABLE `content_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`category` text NOT NULL,
	`explanation` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`target_url` text,
	`snapshot` text,
	`reporter_user_id` text,
	`reporter_name` text,
	`reporter_email` text,
	`created_at` integer NOT NULL,
	`decision` text,
	`ground` text,
	`decision_note` text,
	`decided_by` text,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_content_reports_status` ON `content_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`texts` text NOT NULL,
	`published_at` integer NOT NULL,
	`effective_at` integer NOT NULL,
	`changes` text,
	`published_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legal_documents_version` ON `legal_documents` (`kind`,`version`);--> statement-breakpoint
CREATE TABLE `user_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ground` text,
	`note` text,
	`subject` text,
	`until` integer,
	`decision` text,
	`created_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_user_notices_user` ON `user_notices` (`user_id`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `legal_operator` text;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_version` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_accepted_at` integer;
--> statement-breakpoint
-- The instance name a fresh database got while the product was called Orbit.
UPDATE `instance_settings` SET `instance_name` = 'Tavvit' WHERE `instance_name` = 'Orbit';
