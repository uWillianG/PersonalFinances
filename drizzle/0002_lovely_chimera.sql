CREATE TABLE `budget_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`couple_id` text,
	`scope` text NOT NULL,
	`scope_key` text NOT NULL,
	`month` text NOT NULL,
	`category` text NOT NULL,
	`category_key` text NOT NULL,
	`limit_cents` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_limits_valid_scope" CHECK(("budget_limits"."scope" = 'personal' AND "budget_limits"."couple_id" IS NULL AND "budget_limits"."scope_key" = 'personal:' || "budget_limits"."owner_id") OR ("budget_limits"."scope" = 'couple' AND "budget_limits"."couple_id" IS NOT NULL AND "budget_limits"."scope_key" = 'couple:' || "budget_limits"."couple_id")),
	CONSTRAINT "budget_limits_positive_integer" CHECK(typeof("budget_limits"."limit_cents") = 'integer' AND "budget_limits"."limit_cents" > 0 AND "budget_limits"."limit_cents" <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_limits_scope_month_category` ON `budget_limits` (`scope_key`,`month`,`category_key`);--> statement-breakpoint
CREATE INDEX `budget_limits_owner_month` ON `budget_limits` (`owner_id`,`month`);--> statement-breakpoint
CREATE INDEX `budget_limits_couple_month` ON `budget_limits` (`couple_id`,`month`);--> statement-breakpoint
CREATE TABLE `recurring_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`couple_id` text,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_schedules_valid_scope" CHECK(("recurring_schedules"."scope" = 'personal' AND "recurring_schedules"."couple_id" IS NULL) OR ("recurring_schedules"."scope" = 'couple' AND "recurring_schedules"."couple_id" IS NOT NULL)),
	CONSTRAINT "recurring_schedules_valid_kind" CHECK("recurring_schedules"."kind" IN ('income', 'expense', 'card_payment')),
	CONSTRAINT "recurring_schedules_valid_frequency" CHECK("recurring_schedules"."frequency" IN ('weekly', 'monthly', 'yearly')),
	CONSTRAINT "recurring_schedules_positive_integer" CHECK(typeof("recurring_schedules"."amount_cents") = 'integer' AND "recurring_schedules"."amount_cents" > 0 AND "recurring_schedules"."amount_cents" <= 1000000000000),
	CONSTRAINT "recurring_schedules_valid_range" CHECK("recurring_schedules"."end_date" IS NULL OR "recurring_schedules"."end_date" >= "recurring_schedules"."start_date")
);
--> statement-breakpoint
CREATE INDEX `recurring_schedules_owner` ON `recurring_schedules` (`owner_id`);--> statement-breakpoint
CREATE INDEX `recurring_schedules_couple` ON `recurring_schedules` (`couple_id`);--> statement-breakpoint
CREATE TABLE `schedule_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`due_date` text NOT NULL,
	`state` text NOT NULL,
	`transaction_id` text,
	`confirmed_by` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `recurring_schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_occurrences_valid_state" CHECK("schedule_occurrences"."state" IN ('confirmed', 'linked', 'skipped')),
	CONSTRAINT "schedule_occurrences_link_only" CHECK("schedule_occurrences"."transaction_id" IS NULL OR "schedule_occurrences"."state" = 'linked')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_occurrences_schedule_date` ON `schedule_occurrences` (`schedule_id`,`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_occurrences_transaction` ON `schedule_occurrences` (`transaction_id`);