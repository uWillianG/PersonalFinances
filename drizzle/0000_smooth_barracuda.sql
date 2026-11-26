CREATE TABLE `couple_members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`couple_id` text NOT NULL,
	`slot` integer NOT NULL,
	`joined_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "couple_members_valid_slot" CHECK("couple_members"."slot" IN (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `couple_members_couple_slot` ON `couple_members` (`couple_id`,`slot`);--> statement-breakpoint
CREATE TABLE `couples` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`invite_hash` text,
	`invite_expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `couples_invite_hash` ON `couples` (`invite_hash`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`files_json` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`income_cents` integer DEFAULT 0 NOT NULL,
	`expense_cents` integer DEFAULT 0 NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_owner_id_id` ON `import_batches` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `import_batches_owner_created_at` ON `import_batches` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`institution` text NOT NULL,
	`type` text NOT NULL,
	`initial_balance_cents` integer DEFAULT 0 NOT NULL,
	`balance_date` text NOT NULL,
	`has_opening_balance` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_owner_id_id` ON `sources` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`shared_couple_id` text,
	`installment_current` integer,
	`installment_total` integer,
	`needs_review` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`import_id` text,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `import_batches`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transactions_nonnegative_integer_amount" CHECK(typeof("transactions"."amount_cents") = 'integer' AND "transactions"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_owner_source_fingerprint` ON `transactions` (`owner_id`,`source_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_owner_date` ON `transactions` (`owner_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_shared_couple` ON `transactions` (`shared_couple_id`,`shared`,`owner_id`);--> statement-breakpoint
CREATE INDEX `transactions_import_owner` ON `transactions` (`import_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`updated_at` text NOT NULL
);
