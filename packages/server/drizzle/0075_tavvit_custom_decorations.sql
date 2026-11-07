CREATE TABLE `custom_decorations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`creator_id` text NOT NULL,
	`animated` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`width` integer,
	`height` integer,
	`style` text,
	`shared` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `custom_decorations_creator_idx` ON `custom_decorations` (`creator_id`);--> statement-breakpoint
CREATE INDEX `custom_decorations_gallery_idx` ON `custom_decorations` (`kind`,`shared`,`created_at`);