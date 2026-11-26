CREATE TABLE `reserve_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`month` text NOT NULL,
	`minimum_balance_cents` integer NOT NULL,
	`extra_expense_cents` integer NOT NULL,
	`card_reserve_cents` integer,
	`goal_reserve_cents` integer,
	`shared_commitment_cents` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reserve_plans_minimum_nonnegative" CHECK(typeof("reserve_plans"."minimum_balance_cents") = 'integer' AND "reserve_plans"."minimum_balance_cents" BETWEEN 0 AND 1000000000000),
	CONSTRAINT "reserve_plans_extra_nonnegative" CHECK(typeof("reserve_plans"."extra_expense_cents") = 'integer' AND "reserve_plans"."extra_expense_cents" BETWEEN 0 AND 1000000000000),
	CONSTRAINT "reserve_plans_card_nonnegative" CHECK("reserve_plans"."card_reserve_cents" IS NULL OR (typeof("reserve_plans"."card_reserve_cents") = 'integer' AND "reserve_plans"."card_reserve_cents" BETWEEN 0 AND 1000000000000)),
	CONSTRAINT "reserve_plans_goal_nonnegative" CHECK("reserve_plans"."goal_reserve_cents" IS NULL OR (typeof("reserve_plans"."goal_reserve_cents") = 'integer' AND "reserve_plans"."goal_reserve_cents" BETWEEN 0 AND 1000000000000)),
	CONSTRAINT "reserve_plans_shared_nonnegative" CHECK("reserve_plans"."shared_commitment_cents" IS NULL OR (typeof("reserve_plans"."shared_commitment_cents") = 'integer' AND "reserve_plans"."shared_commitment_cents" BETWEEN 0 AND 1000000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reserve_plans_owner_month` ON `reserve_plans` (`owner_id`,`month`);