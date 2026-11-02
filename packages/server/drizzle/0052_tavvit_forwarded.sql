ALTER TABLE `dm_messages` ADD `forwarded` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `forwarded` integer DEFAULT false NOT NULL;