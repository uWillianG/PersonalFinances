import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  CLEAR_COUPLE_SHARING_SQL,
  DELETE_COUPLE_SQL,
} from "../lib/couple-statements.ts";
import { SET_OCCURRENCE_SQL } from "../lib/planning-statements.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const id of ["alice", "bea", "carla"]) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, '2026-11-26')").run(
      id,
      id,
      `${id}@example.invalid`,
    );
    db.prepare(
      "INSERT INTO sources (id,owner_id,name,institution,type,balance_date) VALUES (?, ?, ?, 'Teste','bank','2026-11-01')",
    ).run(`bank-${id}`, id, id);
    db.prepare(
      "INSERT INTO recurring_schedules (id,owner_id,scope,name,kind,category,amount_cents,frequency,start_date) VALUES (?,?,'personal','Conta','expense','Moradia',10000,'monthly','2026-11-26')",
    ).run(`schedule-${id}`, id);
  }
  db.exec(
    "INSERT INTO couples(id,created_by,created_at) VALUES('ab','alice','2026-11-26'),('c','carla','2026-11-26'); INSERT INTO couple_members VALUES('alice','ab',1,'2026-11-26'),('bea','ab',2,'2026-11-26'),('carla','c',1,'2026-11-26');",
  );
  return db;
}
function transaction(
  db: DatabaseSync,
  id: string,
  owner: string,
  group: string | null,
) {
  db.prepare(
    "INSERT INTO transactions(id,owner_id,source_id,date,description,amount_cents,kind,category,shared,shared_couple_id,fingerprint) VALUES(?,?,?,'2026-11-26','Conta',10000,'expense','Moradia',?,?,?)",
  ).run(id, owner, `bank-${owner}`, group ? 1 : 0, group, id);
}
function leave(db: DatabaseSync, actor: string, group: string) {
  db.exec("BEGIN");
  try {
    const cleared = db
      .prepare(CLEAR_COUPLE_SHARING_SQL)
      .run(group, actor).changes;
    const deleted = db.prepare(DELETE_COUPLE_SQL).run(group, actor).changes;
    db.exec("COMMIT");
    return { cleared, deleted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function link(db: DatabaseSync, actor: string, transactionId: string) {
  return db
    .prepare(SET_OCCURRENCE_SQL)
    .get(
      actor,
      crypto.randomUUID(),
      "2026-11-26",
      "linked",
      transactionId,
      `schedule-${actor}`,
      "monthly",
      "2026-11-26",
      null,
      transactionId,
      transactionId,
    );
}

test("encerrar vínculo limpa compartilhamento dos dois e preserva valores e lançamentos", () => {
  const db = database();
  try {
    transaction(db, "alice-shared", "alice", "ab");
    transaction(db, "bea-shared", "bea", "ab");
    transaction(db, "carla-shared", "carla", "c");
    transaction(db, "bea-private", "bea", null);
    const ledger = () =>
      db
        .prepare(
          "SELECT id,owner_id,source_id,date,description,amount_cents,kind,category,fingerprint FROM transactions ORDER BY id",
        )
        .all();
    const before = ledger();
    assert.deepEqual(leave(db, "alice", "ab"), { cleared: 2, deleted: 1 });
    assert.deepEqual(ledger(), before);
    for (const id of ["alice-shared", "bea-shared"])
      assert.deepEqual(
        {
          ...db
            .prepare(
              "SELECT shared,shared_couple_id FROM transactions WHERE id=?",
            )
            .get(id),
        },
        { shared: 0, shared_couple_id: null },
      );
    assert.equal(
      db
        .prepare("SELECT shared FROM transactions WHERE id='carla-shared'")
        .get()?.shared,
      1,
    );
    assert.ok(link(db, "bea", "bea-shared"));
  } finally {
    db.close();
  }
});

test("registro legado de casal encerrado volta a servir ao planejamento pessoal", () => {
  const db = database();
  try {
    transaction(db, "legacy", "bea", "ab");
    // Reproduce an older release: the group disappears while the peer's raw
    // sharing flag survives. State serialization already shows this as private.
    db.exec("DELETE FROM couples WHERE id='ab'");
    assert.equal(
      db.prepare("SELECT shared FROM transactions WHERE id='legacy'").get()
        ?.shared,
      1,
    );
    assert.ok(link(db, "bea", "legacy"));
  } finally {
    db.close();
  }
});

test("compartilhamento legado de outro vínculo é privado mas o vínculo atual continua protegido", () => {
  const db = database();
  try {
    transaction(db, "legacy", "bea", "deleted-group");
    transaction(db, "active", "bea", "ab");
    transaction(db, "foreign", "alice", null);
    assert.ok(link(db, "bea", "legacy"));
    assert.equal(link(db, "bea", "active"), undefined);
    assert.equal(link(db, "bea", "foreign"), undefined);
    assert.equal(link(db, "carla", "legacy"), undefined);
  } finally {
    db.close();
  }
});

test("ator externo não apaga o casal nem limpa compartilhamento de outras pessoas", () => {
  const db = database();
  try {
    transaction(db, "alice-shared", "alice", "ab");
    transaction(db, "bea-shared", "bea", "ab");
    assert.deepEqual(leave(db, "carla", "ab"), { cleared: 0, deleted: 0 });
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM transactions WHERE shared=1").get()
        ?.count,
      2,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) count FROM couple_members WHERE couple_id='ab'",
        )
        .get()?.count,
      2,
    );
  } finally {
    db.close();
  }
});

test("pedido antigo de saída não modifica compartilhamento do vínculo novo", () => {
  const db = database();
  try {
    transaction(db, "old-peer", "bea", "ab");
    db.exec(
      "DELETE FROM couple_members WHERE user_id='alice'; INSERT INTO couple_members VALUES('alice','c',2,'2026-11-26')",
    );
    transaction(db, "new-group", "alice", "c");
    assert.deepEqual(leave(db, "alice", "ab"), { cleared: 0, deleted: 0 });
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM transactions WHERE shared=1").get()
        ?.count,
      2,
    );
    assert.equal(
      db
        .prepare("SELECT couple_id FROM couple_members WHERE user_id='alice'")
        .get()?.couple_id,
      "c",
    );
  } finally {
    db.close();
  }
});
