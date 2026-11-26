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
