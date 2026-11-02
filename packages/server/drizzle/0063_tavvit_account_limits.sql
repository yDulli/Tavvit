ALTER TABLE `instance_settings` ADD `storage_per_account_bytes` integer DEFAULT 5368709120 NOT NULL;--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `spaces_per_account` integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `storage_limit_bytes` integer;--> statement-breakpoint
CREATE INDEX `idx_attachments_uploader` ON `attachments` (`uploader_id`);