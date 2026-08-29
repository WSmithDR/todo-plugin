import { test } from "node:test"
import assert from "node:assert/strict"
import { ALLOW, advise, deny, mergeDecisions } from "./protocol.ts"

test("sin decisiones → allow", () => {
  assert.equal(mergeDecisions([]).action, "allow")
})

test("todo allow → allow", () => {
  assert.equal(mergeDecisions([ALLOW, ALLOW]).action, "allow")
})

test("un deny gana sobre los advise", () => {
  const d = mergeDecisions([advise("a"), deny("no"), advise("b")])
  assert.deepEqual(d, { action: "deny", message: "no" })
})

test("gana el PRIMER deny", () => {
  const d = mergeDecisions([deny("primero"), deny("segundo")])
  assert.deepEqual(d, { action: "deny", message: "primero" })
})

test("los advise se concatenan en vez de perderse", () => {
  const d = mergeDecisions([advise("uno"), ALLOW, advise("dos")])
  assert.deepEqual(d, { action: "advise", message: "uno\n\ndos" })
})
