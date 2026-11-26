import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  DELETE_RESERVE_PLAN_SQL,
  READ_RESERVE_PLANS_SQL,
  SAVE_RESERVE_PLAN_SQL,
} from "../lib/reserve-statements.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const id of ["alice", "bea"])
    db.prepare("INSERT INTO users VALUES (?, ?, ?, '2026-11-26')").run(
      id,
      id,
      `${id}@example.invalid`,
    );
  db.exec(`INSERT INTO couples (id, created_by, created_at) VALUES ('together', 'alice', '2026-11-26');
    INSERT INTO couple_members VALUES ('alice', 'together', 1, '2026-11-26'), ('bea', 'together', 2, '2026-11-26');`);
  return db;
}

test("salvar ajustes faz upsert por proprietário e mês, preserva identidade e distingue null de zero", () => {
  const db = database();
  try {
    const save = db.prepare(SAVE_RESERVE_PLAN_SQL);
    const first = save.get(
      "first",
      "alice",
      "2026-11",
      50000,
      10000,
      null,
      null,
      null,
    );
    assert.equal(first?.id, "first");
    assert.equal(first?.cardReserveCents, null);
    const repeated = save.get(
      "discarded-id",
      "alice",
      "2026-11",
      80000,
      2500,
      0,
      1000,
      0,
    );
    assert.equal(repeated?.id, "first");
    assert.equal(repeated?.minimumBalanceCents, 80000);
    assert.equal(repeated?.cardReserveCents, 0);
    assert.equal(repeated?.goalReserveCents, 1000);
    save.get("next", "alice", "2026-12", 0, 0, null, null, null);
    assert.equal(db.prepare(READ_RESERVE_PLANS_SQL).all("alice").length, 2);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM transactions").get()?.n,
      0,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM goal_movements").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test("parceiros do mesmo casal não leem nem removem ajustes pessoais um do outro", () => {
  const db = database();
  try {
    const save = db.prepare(SAVE_RESERVE_PLAN_SQL);
    save.get("alice-plan", "alice", "2026-11", 12345, 0, null, null, null);
    assert.deepEqual(db.prepare(READ_RESERVE_PLANS_SQL).all("bea"), []);
    assert.equal(
      db.prepare(DELETE_RESERVE_PLAN_SQL).run("bea", "2026-11").changes,
      0,
    );
    save.get("bea-plan", "bea", "2026-11", 98765, 0, null, null, null);
    assert.equal(
      db.prepare(READ_RESERVE_PLANS_SQL).all("bea")[0]?.minimumBalanceCents,
      98765,
    );
    assert.equal(
      db.prepare(DELETE_RESERVE_PLAN_SQL).run("bea", "2026-11").changes,
      1,
    );
    assert.equal(
      db.prepare(READ_RESERVE_PLANS_SQL).all("alice")[0]?.minimumBalanceCents,
      12345,
    );
    assert.equal(
      db.prepare(DELETE_RESERVE_PLAN_SQL).run("alice", "2026-11").changes,
      1,
    );
    assert.equal(
      db.prepare(DELETE_RESERVE_PLAN_SQL).run("alice", "2026-11").changes,
      0,
    );
  } finally {
    db.close();
  }
});

test("schema impede valores inválidos, exige dono existente e apaga somente ajustes do usuário removido", () => {
  const db = database();
  try {
    const save = db.prepare(SAVE_RESERVE_PLAN_SQL);
    for (const values of [
      [-1, 0, null, null, null],
      [0.5, 0, null, null, null],
      [0, -1, null, null, null],
      [0, 0, -1, null, null],
      [0, 0, null, -1, null],
      [0, 0, null, null, -1],
      [0, 0, null, null, 1_000_000_000_001],
    ])
      assert.throws(
        () => save.get("invalid", "alice", "2026-11", ...values),
        /CHECK/,
      );
    assert.throws(
      () => save.get("orphan", "missing", "2026-11", 0, 0, null, null, null),
      /FOREIGN KEY/,
    );
    save.get("alice-plan", "alice", "2026-11", 0, 0, null, null, null);
    save.get("bea-plan", "bea", "2026-11", 0, 0, null, null, null);
    db.exec(
      "DELETE FROM couple_members WHERE user_id = 'bea'; DELETE FROM users WHERE id = 'bea'",
    );
    assert.equal(db.prepare(READ_RESERVE_PLANS_SQL).all("bea").length, 0);
    assert.equal(db.prepare(READ_RESERVE_PLANS_SQL).all("alice").length, 1);
  } finally {
    db.close();
  }
});
