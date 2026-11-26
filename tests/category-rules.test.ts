import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryRuleKey } from "../lib/category-rules.ts";
test("categorization rules ignore accents, spacing and installment suffixes",()=>{
  assert.equal(categoryRuleKey("  LOJA São José parcela 02/06  "),"loja sao jose");
  assert.equal(categoryRuleKey("Loja Sao Jose 03/06"),"loja sao jose");
  assert.notEqual(categoryRuleKey("Loja 1"),categoryRuleKey("Loja 2"));
  assert.equal(categoryRuleKey("Mercado São João"),categoryRuleKey("MERCADO SAO JOAO"));
});
