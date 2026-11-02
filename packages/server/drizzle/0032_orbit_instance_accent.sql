ALTER TABLE `instance_settings` ADD `accent_color` text;--> statement-breakpoint
-- An instance that still carries the upstream default name was never named by its admin: show it as Orbit. A name an admin chose is left alone.
UPDATE `instance_settings` SET `instance_name` = 'Orbit' WHERE `instance_name` IS NULL OR `instance_name` = 'Backspace';
