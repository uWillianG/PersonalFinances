CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`description` text NOT NULL,
	`normalized_description` text NOT NULL,
	`category` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_owner_key` ON `category_rules` (`owner_id`,`normalized_description`);