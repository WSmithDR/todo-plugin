import { test } from "node:test"
import assert from "node:assert/strict"
import { toToolEvent } from "./normalize.ts"

test("edit usa filePath/newString en camelCase", () => {
  const event = toToolEvent("edit", { filePath: "/p/.todo/TODO.md", newString: "- [x] listo" }, "/p", "before")
  assert.equal(event.kind, "edit")
  assert.deepEqual(event.paths, ["/p/.todo/TODO.md"])
  assert.deepEqual(event.contents, ["- [x] listo"])
})

// El bridge anterior mandaba los args crudos a un guard que solo miraba
// `new_string`: sobre un `edit` de OpenCode el guard duro nunca disparaba.
test("newString y new_string se leen las dos", () => {
  assert.deepEqual(toToolEvent("edit", { newString: "a" }, "/p", "before").contents, ["a"])
  assert.deepEqual(toToolEvent("edit", { new_string: "a" }, "/p", "before").contents, ["a"])
})

test("write usa content", () => {
  assert.deepEqual(toToolEvent("write", { filePath: "/x", content: "hola" }, "/p", "before").contents, ["hola"])
})

test("patch escribe archivos, así que cuenta como edit", () => {
  assert.equal(toToolEvent("patch", { filePath: "/p/.todo/TODO.md" }, "/p", "before").kind, "edit")
})

test("bash trae el comando", () => {
  const event = toToolEvent("bash", { command: "ls -la" }, "/p", "before")
  assert.equal(event.kind, "bash")
  assert.equal(event.command, "ls -la")
})

test("read u otra tool cae en 'other'", () => {
  assert.equal(toToolEvent("read", { filePath: "/x" }, "/p", "before").kind, "other")
})

test("sin args no explota", () => {
  const event = toToolEvent("bash", {}, "/p", "before")
  assert.deepEqual(event.paths, [])
  assert.deepEqual(event.contents, [])
})

// ── detección del fallo en fase after ──────────────────────────────────────

test("un exit code numérico distinto de 0 marca fallo", () => {
  for (const key of ["exit", "exitCode", "exit_code", "code", "status"]) {
    const event = toToolEvent("bash", {}, "/p", "after", { output: "boom", metadata: { [key]: 1 } })
    assert.equal(event.result?.ok, false, key)
  }
})

test("la forma REAL de opencode 1.17.18 se lee como fallo", () => {
  // Capturada con un plugin espía sobre `ls /noexiste`: es el contrato que hay
  // que preservar, no una forma inventada. Si una versión futura lo renombra,
  // este test es el que lo delata.
  const event = toToolEvent("bash", { command: "ls /noexiste-xyz" }, "/p", "after", {
    output: "ls: no se puede acceder a '/noexiste-xyz': No existe el archivo o el directorio\n",
    metadata: { output: "ls: no se puede acceder…\n", exit: 2, truncated: false },
  })
  assert.equal(event.result?.ok, false)
  assert.match(event.result?.text ?? "", /No existe el archivo/)
})

test("exit code 0 es éxito", () => {
  assert.equal(toToolEvent("bash", {}, "/p", "after", { output: "ok", metadata: { exit: 0 } }).result?.ok, true)
})

test("sin metadata reconocible se asume éxito", () => {
  // Degradación segura: error-triage calla en vez de inventar un aviso sobre un
  // comando que anduvo bien.
  assert.equal(toToolEvent("bash", {}, "/p", "after", { output: "x", metadata: { otra: "cosa" } }).result?.ok, true)
  assert.equal(toToolEvent("bash", {}, "/p", "after", { output: "x" }).result?.ok, true)
})

test("el output de la tool llega como texto del resultado", () => {
  assert.equal(toToolEvent("bash", {}, "/p", "after", { output: "la salida" }).result?.text, "la salida")
})
