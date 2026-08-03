import { test } from "node:test"
import assert from "node:assert/strict"
import { errorTriage } from "./error-triage.ts"
import type { ToolEvent } from "../protocol.ts"

const failed = (command: string, text = "boom"): ToolEvent => ({
  phase: "after",
  kind: "bash",
  paths: [],
  contents: [],
  command,
  cwd: "/proj",
  result: { ok: false, text },
})

const CTX = { hasTodoDir: true }

test("comando exitoso → allow", () => {
  const event = { ...failed("npm run build"), result: { ok: true, text: "" } }
  assert.equal(errorTriage(event, CTX).action, "allow")
})

test("comando fallido → advise, nunca deny (ya corrió)", () => {
  const d = errorTriage(failed("npm run build"), CTX)
  assert.equal(d.action, "advise")
  assert.match(d.action === "advise" ? d.message : "", /TODO-ERROR-CHECKER/)
})

test("sin .todo/ → allow (no hay dónde anotar)", () => {
  assert.equal(errorTriage(failed("npm run build"), { hasTodoDir: false }).action, "allow")
})

test("comandos triviales que devuelven non-zero por diseño → allow", () => {
  for (const cmd of ["grep foo x.txt", "ls /nope", "test -f x", "diff a b", "wc -l x"]) {
    assert.equal(errorTriage(failed(cmd), CTX).action, "allow", cmd)
  }
})

test("fallo ya previsto por el autor → allow", () => {
  for (const cmd of ["foo 2>/dev/null", "which bar >/dev/null", "cmd || exit 0"]) {
    assert.equal(errorTriage(failed(cmd), CTX).action, "allow", cmd)
  }
})

test("el output se recorta a 5 líneas", () => {
  const d = errorTriage(failed("npm test", "1\n2\n3\n4\n5\n6\n7"), CTX)
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /5/)
  assert.doesNotMatch(message, /\b6\b/)
})

test("sin output → placeholder en vez de vacío", () => {
  const d = errorTriage(failed("npm test", "   "), CTX)
  assert.match(d.action === "advise" ? d.message : "", /\(sin output\)/)
})

test("fase before → allow (la regla es de post-ejecución)", () => {
  assert.equal(errorTriage({ ...failed("x"), phase: "before" }, CTX).action, "allow")
})
