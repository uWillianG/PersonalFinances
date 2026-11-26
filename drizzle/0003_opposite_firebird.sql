CREATE TABLE `goal_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_movements_valid_kind" CHECK("goal_movements"."kind" IN ('deposit', 'withdrawal')),
	CONSTRAINT "goal_movements_positive_amount" CHECK(typeof("goal_movements"."amount_cents") = 'integer' AND "goal_movements"."amount_cents" > 0 AND "goal_movements"."amount_cents" <= 1000000000000)
);
--> statement-breakpoint
CREATE INDEX `goal_movements_goal_date` ON `goal_movements` (`goal_id`,`date`);--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`couple_id` text,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`target_cents` integer NOT NULL,
	`target_date` text,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`couple_id`) REFERENCES `couples`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "savings_goals_valid_scope" CHECK(("savings_goals"."scope" = 'personal' AND "savings_goals"."couple_id" IS NULL) OR ("savings_goals"."scope" = 'couple' AND "savings_goals"."couple_id" IS NOT NULL)),
	CONSTRAINT "savings_goals_positive_target" CHECK(typeof("savings_goals"."target_cents") = 'integer' AND "savings_goals"."target_cents" > 0 AND "savings_goals"."target_cents" <= 1000000000000),
	CONSTRAINT "savings_goals_valid_archived" CHECK("savings_goals"."archived" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `savings_goals_owner` ON `savings_goals` (`owner_id`);--> statement-breakpoint
CREATE INDEX `savings_goals_couple` ON `savings_goals` (`couple_id`);