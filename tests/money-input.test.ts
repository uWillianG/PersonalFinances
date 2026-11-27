import assert from "node:assert/strict";
import { test } from "node:test";
import { moneyInputCents } from "../lib/money-input.ts";

test("milhares brasileiros sem centavos não são interpretados como decimais", () => {
  assert.equal(moneyInputCents("1.000"), 100000);
  assert.equal(moneyInputCents("1.250"), 125000);
  assert.equal(moneyInputCents("12.345.678"), 1234567800);
  assert.equal(moneyInputCents("R$ 1.234,56"), 123456);
});
test("editar valores existentes com ponto decimal preserva os centavos e permite saldo negativo", () => {
  for (const value of ["1250.5", "1250.50", "1250,50"])
    assert.equal(moneyInputCents(value), 125050);
  assert.equal(moneyInputCents("-R$ 1.250,50"), -125050);
  assert.equal(moneyInputCents("R$ -1.250,50"), -125050);
  assert.equal(moneyInputCents("0"), 0);
});
test("formatos ambíguos, frações excessivas, moeda estrangeira e valores fora do limite são rejeitados", () => {
  for (const value of [
    "",
    "1.23,45",
    "1,234.56",
    "1000.001",
    "1,234",
    "1e3",
    "USD 100",
    "€ 100",
    "NaN",
    "Infinity",
    "10000000000,01",
  ])
    assert.throws(() => moneyInputCents(value), /valor|limite/);
  assert.equal(moneyInputCents("10.000.000.000,00"), 1000000000000);
});
