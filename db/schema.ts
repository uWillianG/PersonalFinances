import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    description: text("description").notNull(),
    key: text("normalized_description").notNull(),
    category: text("category").notNull(),
  },
  (table) => [
    uniqueIndex("category_rules_owner_key").on(table.ownerId, table.key),
  ],
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    institution: text("institution").notNull(),
    type: text("type", { enum: ["bank", "credit", "benefit"] }).notNull(),
    initialBalanceCents: integer("initial_balance_cents").notNull().default(0),
    balanceDate: text("balance_date").notNull(),
    hasOpeningBalance: integer("has_opening_balance", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [uniqueIndex("sources_owner_id_id").on(table.ownerId, table.id)],
);

export const couples = sqliteTable(
  "couples",
  {
    id: text("id").primaryKey(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    inviteHash: text("invite_hash"),
    inviteExpiresAt: text("invite_expires_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("couples_invite_hash").on(table.inviteHash)],
);

export const coupleMembers = sqliteTable(
  "couple_members",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    coupleId: text("couple_id")
      .notNull()
      .references(() => couples.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => [
    uniqueIndex("couple_members_couple_slot").on(table.coupleId, table.slot),
    check("couple_members_valid_slot", sql`${table.slot} IN (1, 2)`),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    filesJson: text("files_json").notNull(),
    count: integer("count").notNull().default(0),
    incomeCents: integer("income_cents").notNull().default(0),
    expenseCents: integer("expense_cents").notNull().default(0),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
  },
  (table) => [
    uniqueIndex("import_batches_owner_id_id").on(table.ownerId, table.id),
    index("import_batches_owner_created_at").on(table.ownerId, table.createdAt),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    sourceId: text("source_id").notNull(),
    date: text("date").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    kind: text("kind", {
      enum: [
        "income",
        "expense",
        "transfer_in",
        "transfer_out",
        "card_payment",
        "refund",
      ],
    }).notNull(),
    category: text("category").notNull(),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    // Bind sharing to the explicitly selected relationship, including after a
    // user leaves and joins another couple.
    sharedCoupleId: text("shared_couple_id"),
    installmentCurrent: integer("installment_current"),
    installmentTotal: integer("installment_total"),
    needsReview: integer("needs_review", { mode: "boolean" })
      .notNull()
      .default(false),
    note: text("note").notNull().default(""),
    importId: text("import_id"),
    fingerprint: text("fingerprint").notNull(),
  },
  (table) => [
    uniqueIndex("transactions_owner_source_fingerprint").on(
      table.ownerId,
      table.sourceId,
      table.fingerprint,
    ),
    check(
      "transactions_nonnegative_integer_amount",
      sql`typeof(${table.amountCents}) = 'integer' AND ${table.amountCents} >= 0`,
    ),
    index("transactions_owner_date").on(table.ownerId, table.date),
    index("transactions_shared_couple").on(
      table.sharedCoupleId,
      table.shared,
      table.ownerId,
    ),
    index("transactions_import_owner").on(table.importId, table.ownerId),
    foreignKey({
      columns: [table.ownerId, table.sourceId],
      foreignColumns: [sources.ownerId, sources.id],
    }),
    foreignKey({
      columns: [table.ownerId, table.importId],
      foreignColumns: [importBatches.ownerId, importBatches.id],
    }).onDelete("cascade"),
  ],
);

// Planning is separate from the financial ledger: confirming a due date never
// inserts a transaction or changes a source balance.
export const budgetLimits = sqliteTable(
  "budget_limits",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    coupleId: text("couple_id").references(() => couples.id, {
      onDelete: "cascade",
    }),
    scope: text("scope", { enum: ["personal", "couple"] }).notNull(),
    scopeKey: text("scope_key").notNull(),
    month: text("month").notNull(),
    category: text("category").notNull(),
    categoryKey: text("category_key").notNull(),
    limitCents: integer("limit_cents").notNull(),
  },
  (table) => [
    uniqueIndex("budget_limits_scope_month_category").on(
      table.scopeKey,
      table.month,
      table.categoryKey,
    ),
    index("budget_limits_owner_month").on(table.ownerId, table.month),
    index("budget_limits_couple_month").on(table.coupleId, table.month),
    check(
      "budget_limits_valid_scope",
      sql`(${table.scope} = 'personal' AND ${table.coupleId} IS NULL AND ${table.scopeKey} = 'personal:' || ${table.ownerId}) OR (${table.scope} = 'couple' AND ${table.coupleId} IS NOT NULL AND ${table.scopeKey} = 'couple:' || ${table.coupleId})`,
    ),
    check(
      "budget_limits_positive_integer",
      sql`typeof(${table.limitCents}) = 'integer' AND ${table.limitCents} > 0 AND ${table.limitCents} <= 1000000000000`,
    ),
  ],
);

export const recurringSchedules = sqliteTable(
  "recurring_schedules",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    coupleId: text("couple_id").references(() => couples.id, {
      onDelete: "cascade",
    }),
    scope: text("scope", { enum: ["personal", "couple"] }).notNull(),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["income", "expense", "card_payment"],
    }).notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    frequency: text("frequency", {
      enum: ["weekly", "monthly", "yearly"],
    }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    index("recurring_schedules_owner").on(table.ownerId),
    index("recurring_schedules_couple").on(table.coupleId),
    check(
      "recurring_schedules_valid_scope",
      sql`(${table.scope} = 'personal' AND ${table.coupleId} IS NULL) OR (${table.scope} = 'couple' AND ${table.coupleId} IS NOT NULL)`,
    ),
    check(
      "recurring_schedules_valid_kind",
      sql`${table.kind} IN ('income', 'expense', 'card_payment')`,
    ),
    check(
      "recurring_schedules_valid_frequency",
      sql`${table.frequency} IN ('weekly', 'monthly', 'yearly')`,
    ),
    check(
      "recurring_schedules_positive_integer",
      sql`typeof(${table.amountCents}) = 'integer' AND ${table.amountCents} > 0 AND ${table.amountCents} <= 1000000000000`,
    ),
    check(
      "recurring_schedules_valid_range",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

export const scheduleOccurrences = sqliteTable(
  "schedule_occurrences",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => recurringSchedules.id, { onDelete: "cascade" }),
    dueDate: text("due_date").notNull(),
    state: text("state", {
      enum: ["confirmed", "linked", "skipped"],
    }).notNull(),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    confirmedBy: text("confirmed_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    uniqueIndex("schedule_occurrences_schedule_date").on(
      table.scheduleId,
      table.dueDate,
    ),
    uniqueIndex("schedule_occurrences_transaction").on(table.transactionId),
    check(
      "schedule_occurrences_valid_state",
      sql`${table.state} IN ('confirmed', 'linked', 'skipped')`,
    ),
    check(
      "schedule_occurrences_link_only",
      sql`${table.transactionId} IS NULL OR ${table.state} = 'linked'`,
    ),
  ],
);
