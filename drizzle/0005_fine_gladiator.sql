CREATE TABLE `card_cycles` (
	`source_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`closing_day` integer NOT NULL,
	`due_day` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_cycles_valid_closing" CHECK(typeof("card_cycles"."closing_day") = 'integer' AND "card_cycles"."closing_day" BETWEEN 1 AND 31),
	CONSTRAINT "card_cycles_valid_due" CHECK(typeof("card_cycles"."due_day") = 'integer' AND "card_cycles"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE `card_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`month` text NOT NULL,
	`confirmed_total_cents` integer,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "card_invoices_nonnegative_total" CHECK("card_invoices"."confirmed_total_cents" IS NULL OR (typeof("card_invoices"."confirmed_total_cents") = 'integer' AND "card_invoices"."confirmed_total_cents" BETWEEN 0 AND 1000000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_invoices_owner_id_id` ON `card_invoices` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `card_invoices_owner_source_month` ON `card_invoices` (`owner_id`,`source_id`,`month`);--> statement-breakpoint
CREATE TABLE `import_balance_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`source_id` text NOT NULL,
	`before_balance_cents` integer NOT NULL,
	`before_balance_date` text NOT NULL,
	`before_has_opening_balance` integer NOT NULL,
	`before_version` text NOT NULL,
	`after_version` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `import_batches`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_balance_changes_import_source` ON `import_balance_changes` (`import_id`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_balance_changes_after_version` ON `import_balance_changes` (`after_version`);--> statement-breakpoint
CREATE TABLE `invoice_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`invoice_id`) REFERENCES `card_invoices`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invoice_payments_positive_amount" CHECK(typeof("invoice_payments"."amount_cents") = 'integer' AND "invoice_payments"."amount_cents" BETWEEN 1 AND 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_payments_invoice_transaction` ON `invoice_payments` (`invoice_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `invoice_payments_owner_transaction` ON `invoice_payments` (`owner_id`,`transaction_id`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `balance_tracking` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `balance_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_owner_id_id` ON `transactions` (`owner_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `invoice_payments_valid_insert` BEFORE INSERT ON `invoice_payments`
WHEN NOT EXISTS (
  SELECT 1 FROM `card_invoices` i
  JOIN `sources` card ON card.id = i.source_id AND card.owner_id = i.owner_id AND card.type = 'credit'
  JOIN `transactions` t ON t.id = NEW.transaction_id AND t.owner_id = NEW.owner_id AND t.kind = 'card_payment'
  JOIN `sources` bank ON bank.id = t.source_id AND bank.owner_id = t.owner_id AND bank.type = 'bank'
  WHERE i.id = NEW.invoice_id AND i.owner_id = NEW.owner_id
  AND NEW.amount_cents + COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.transaction_id = t.id AND p.invoice_id <> NEW.invoice_id), 0) <= t.amount_cents
)
BEGIN SELECT RAISE(ABORT, 'invalid_invoice_payment'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_payments_valid_update` BEFORE UPDATE ON `invoice_payments`
WHEN NOT EXISTS (
  SELECT 1 FROM `card_invoices` i
  JOIN `sources` card ON card.id = i.source_id AND card.owner_id = i.owner_id AND card.type = 'credit'
  JOIN `transactions` t ON t.id = NEW.transaction_id AND t.owner_id = NEW.owner_id AND t.kind = 'card_payment'
  JOIN `sources` bank ON bank.id = t.source_id AND bank.owner_id = t.owner_id AND bank.type = 'bank'
  WHERE i.id = NEW.invoice_id AND i.owner_id = NEW.owner_id
  AND NEW.amount_cents + COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.transaction_id = t.id AND p.id <> OLD.id), 0) <= t.amount_cents
)
BEGIN SELECT RAISE(ABORT, 'invalid_invoice_payment'); END;
--> statement-breakpoint
CREATE TRIGGER `transactions_preserve_invoice_payment` BEFORE UPDATE OF amount_cents,kind,source_id,owner_id ON `transactions`
WHEN EXISTS (SELECT 1 FROM invoice_payments p WHERE p.transaction_id = OLD.id)
AND (NEW.kind <> 'card_payment' OR NEW.amount_cents < (SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.transaction_id = OLD.id)
  OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = NEW.source_id AND s.owner_id = NEW.owner_id AND s.type = 'bank'))
BEGIN SELECT RAISE(ABORT, 'linked_invoice_payment_conflict'); END;
--> statement-breakpoint
CREATE TRIGGER `sources_preserve_invoice_type` BEFORE UPDATE OF type ON `sources`
WHEN (NEW.type <> 'credit' AND (EXISTS (SELECT 1 FROM card_cycles c WHERE c.source_id = OLD.id) OR EXISTS (SELECT 1 FROM card_invoices i WHERE i.source_id = OLD.id)))
  OR (NEW.type <> 'bank' AND EXISTS (SELECT 1 FROM invoice_payments p JOIN transactions t ON t.id = p.transaction_id WHERE t.source_id = OLD.id))
BEGIN SELECT RAISE(ABORT, 'linked_invoice_source_type_conflict'); END;
