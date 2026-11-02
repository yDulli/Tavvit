ALTER TABLE `instance_settings` ADD `signup_challenge` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
UPDATE `instance_settings` SET `signup_challenge` = 'normal';
