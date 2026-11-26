import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  ADD_GOAL_MOVEMENT_SQL,
  CREATE_GOAL_SQL,
  DELETE_EMPTY_GOAL_SQL,
  GOAL_ACCESS_SQL,
} from "../lib/goals-statements.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const id of ["alice", "bea", "carla"])
    db.prepare("INSERT INTO users VALUES (?, ?, ?, '2026-11-25')").run(
      id,
      id,
      `${id}@example.invalid`,
    );
  db.exec(`INSERT INTO couples (id, created_by, created_at) VALUES ('group-ab', 'alice', '2026-11-25'), ('group-c', 'carla', '2026-11-25');
    INSERT INTO couple_members VALUES ('alice', 'group-ab', 1, '2026-11-25'), ('bea', 'group-ab', 2, '2026-11-25'), ('carla', 'group-c', 1, '2026-11-25');
    INSERT INTO sources (id, owner_id, name, institution, type, initial_balance_cents, balance_date) VALUES ('source', 'alice', 'Conta', 'Teste', 'bank', 300000, '2026-11-01');
    INSERT INTO transactions (id,owner_id,source_id,date,description,amount_cents,kind,category,fingerprint) VALUES ('salary','alice','source','2026-11-02','Salário',100000,'income','Salário','salary');`);
  return db;
}

function create(
  db: DatabaseSync,
  id: string,
  owner = "alice",
  group: string | null = null,
) {
  return db
    .prepare(CREATE_GOAL_SQL)
    .get(
      id,
      owner,
      group,
      group ? "couple" : "personal",
      "Viagem",
      50000,
      null,
      0,
    );
}

function movement(
  db: DatabaseSync,
  actor: string,
  id: string,
  goal: string,
  amount = 10000,
  kind = "deposit",
) {
  return db
    .prepare(ADD_GOAL_MOVEMENT_SQL)
    .get(
      actor,
      id,
      goal,
      kind,
      amount,
      "2026-11-25",
      "",
      "2026-11-25T12:00:00Z",
    );
}

function balance(db: DatabaseSync, goal: string) {
  return db
    .prepare(
      "SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS amount FROM goal_movements WHERE goal_id = ?",
    )
    .get(goal)?.amount;
}

test("caixinhas pessoais e seu histórico ficam restritos ao titular", () => {
  const db = database();
  try {
    create(db, "private");
    assert.ok(movement(db, "alice", "a1", "private"));
    assert.equal(movement(db, "bea", "b1", "private"), undefined);
    const read = db.prepare(
      `WITH actor AS (SELECT ? AS user_id) SELECT m.id FROM goal_movements m JOIN savings_goals g ON g.id = m.goal_id WHERE ${GOAL_ACCESS_SQL}`,
    );
    assert.equal(read.all("alice").length, 1);
    assert.equal(read.all("bea").length, 0);
    assert.equal(
      db.prepare(DELETE_EMPTY_GOAL_SQL).get("bea", "private"),
      undefined,
    );
  } finally {
    db.close();
  }
});

test("caixinhas do casal revalidam o vínculo na criação e em cada aporte ou resgate", () => {
  const db = database();
  try {
    assert.equal(create(db, "invalid", "carla", "group-ab"), undefined);
    assert.ok(create(db, "shared", "alice", "group-ab"));
    assert.ok(movement(db, "bea", "b1", "shared"));
    assert.equal(movement(db, "carla", "c1", "shared"), undefined);
    db.exec("DELETE FROM couple_members WHERE user_id = 'bea'");
    assert.equal(
      movement(db, "bea", "b2", "shared", 5000, "withdrawal"),
      undefined,
    );
    db.exec(
      "INSERT INTO couple_members VALUES ('bea', 'group-c', 2, '2026-11-25')",
    );
    assert.equal(movement(db, "bea", "b3", "shared"), undefined);
    const read = db.prepare(
      `WITH actor AS (SELECT ? AS user_id) SELECT g.id FROM savings_goals g WHERE ${GOAL_ACCESS_SQL}`,
    );
    assert.equal(read.all("bea").length, 0);
    assert.equal(read.all("alice").length, 1);
    assert.equal(balance(db, "shared"), 10000);
  } finally {
    db.close();
  }
});

test("resgates usam o saldo do momento da inserção e impedem saque duplo ou valor negativo", () => {
  const db = database();
  try {
    create(db, "goal");
    assert.equal(
      movement(db, "alice", "empty", "goal", 1, "withdrawal"),
      undefined,
    );
    movement(db, "alice", "deposit", "goal", 10000);
    // Two requests may both have seen 10000 before insertion. Each guarded
    // statement must observe the balance left by the previous committed write.
    assert.ok(movement(db, "alice", "withdraw-1", "goal", 6000, "withdrawal"));
    assert.equal(
      movement(db, "alice", "withdraw-2", "goal", 6000, "withdrawal"),
      undefined,
    );
    assert.equal(balance(db, "goal"), 4000);
    assert.ok(
      movement(db, "alice", "withdraw-rest", "goal", 4000, "withdrawal"),
    );
    assert.equal(balance(db, "goal"), 0);
  } finally {
    db.close();
  }
});

test("UUID repetido é imutável e não duplica o valor reservado", () => {
  const db = database();
  try {
    create(db, "goal");
    create(db, "other");
    assert.ok(movement(db, "alice", "same-id", "goal", 12000));
    assert.equal(movement(db, "alice", "same-id", "goal", 12000), undefined);
    assert.equal(movement(db, "alice", "same-id", "goal", 15000), undefined);
    assert.equal(movement(db, "alice", "same-id", "other", 15000), undefined);
    assert.equal(balance(db, "goal"), 12000);
    assert.equal(balance(db, "other"), 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM goal_movements").get()?.count,
      1,
    );
  } finally {
    db.close();
  }
});

test("arquivar preserva a reserva, bloqueia aportes e permite resgate sem alterar o extrato", () => {
  const db = database();
  try {
    create(db, "goal");
    movement(db, "alice", "deposit", "goal", 40000);
    db.exec("UPDATE savings_goals SET archived = 1 WHERE id = 'goal'");
    assert.equal(movement(db, "alice", "new-deposit", "goal"), undefined);
    assert.equal(balance(db, "goal"), 40000);
    assert.ok(movement(db, "alice", "withdraw", "goal", 40000, "withdrawal"));
    assert.equal(balance(db, "goal"), 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM transactions").get()?.count,
      1,
    );
    assert.equal(
      db.prepare("SELECT initial_balance_cents amount FROM sources").get()
        ?.amount,
      300000,
    );
    assert.equal(
      db.prepare(DELETE_EMPTY_GOAL_SQL).get("alice", "goal"),
      undefined,
    );
  } finally {
    db.close();
  }
});

test("somente meta sem histórico pode ser excluída e autorização continua obrigatória", () => {
  const db = database();
  try {
    create(db, "private");
    create(db, "shared", "alice", "group-ab");
    assert.equal(
      db.prepare(DELETE_EMPTY_GOAL_SQL).get("bea", "private"),
      undefined,
    );
    assert.equal(
      db.prepare(DELETE_EMPTY_GOAL_SQL).get("carla", "shared"),
      undefined,
    );
    assert.ok(db.prepare(DELETE_EMPTY_GOAL_SQL).get("bea", "shared"));
    assert.ok(db.prepare(DELETE_EMPTY_GOAL_SQL).get("alice", "private"));
  } finally {
    db.close();
  }
});

test("reservas respeitam o limite agregado e restrições de centavos do banco", () => {
  const db = database();
  try {
    create(db, "goal");
    assert.ok(movement(db, "alice", "limit", "goal", 1_000_000_000_000));
    assert.equal(movement(db, "alice", "overflow", "goal", 1), undefined);
    assert.ok(movement(db, "alice", "withdraw", "goal", 1, "withdrawal"));
    assert.ok(movement(db, "alice", "refill", "goal", 1));
    assert.equal(balance(db, "goal"), 1_000_000_000_000);
    assert.throws(() => movement(db, "alice", "negative", "goal", -1), /CHECK/);
    db.exec("UPDATE savings_goals SET archived = 1 WHERE id = 'goal'");
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE savings_goals SET target_cents = 0 WHERE id = 'goal'",
          )
          .run(),
      /CHECK/,
    );
  } finally {
    db.close();
  }
});
