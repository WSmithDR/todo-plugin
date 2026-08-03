import { test } from "node:test"
import assert from "node:assert/strict"
import { parsePayload, toToolEvent } from "./normalize.ts"

test("un payload que no es JSON devuelve null", () => {
  assert.equal(parsePayload(""), null)
  assert.equal(parsePayload("no soy json"), null)
  assert.equal(parsePayload("null"), null)
  assert.equal(parsePayload('"un string"'), null)
})

test("Edit → kind edit, path y new_string", () => {
  const payload = parsePayload(
    JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: "/p/.todo/TODO.md", old_string: "a", new_string: "- [x] b" },
      cwd: "/p",
    }),
  )!
  const event = toToolEvent(payload, "before")
  assert.equal(event.kind, "edit")
  assert.deepEqual(event.paths, ["/p/.todo/TODO.md"])
  assert.deepEqual(event.contents, ["- [x] b"])
  assert.equal(event.cwd, "/p")
})

test("Write usa content", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/x", content: "hola" } }))!
  assert.deepEqual(toToolEvent(payload, "before").contents, ["hola"])
})

test("MultiEdit junta los new_string de todos los edits", () => {
  const payload = parsePayload(
    JSON.stringify({
      tool_name: "MultiEdit",
      tool_input: { file_path: "/x", edits: [{ new_string: "uno" }, { new_string: "dos" }, { sin: "new_string" }] },
    }),
  )!
  assert.deepEqual(toToolEvent(payload, "before").contents, ["uno", "dos"])
})

test("filePath en camelCase también se lee", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "Write", tool_input: { filePath: "/p/.todo/x.md" } }))!
  assert.deepEqual(toToolEvent(payload, "before").paths, ["/p/.todo/x.md"])
})

test("una tool desconocida cae en 'other'", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "WebFetch", tool_input: {} }))!
  assert.equal(toToolEvent(payload, "before").kind, "other")
})

test("sin tool_input no explota", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "Bash" }))!
  const event = toToolEvent(payload, "before")
  assert.deepEqual(event.paths, [])
  assert.deepEqual(event.contents, [])
  assert.equal(event.command, undefined)
})

// ── tool_response: cada forma apareció de verdad en algún payload ──────────

test("is_error en la raíz", () => {
  const payload = parsePayload(
    JSON.stringify({ tool_name: "Bash", tool_response: { is_error: true, stderr: "boom" } }),
  )!
  assert.deepEqual(toToolEvent(payload, "after").result, { ok: false, text: "boom" })
})

test("exit_code distinto de 0", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "Bash", tool_response: { exit_code: 1, stdout: "x" } }))!
  assert.equal(toToolEvent(payload, "after").result?.ok, false)
})

test("is_error dentro de content[]", () => {
  const payload = parsePayload(
    JSON.stringify({ tool_name: "Bash", tool_response: { content: [{ is_error: true, text: "falló" }] } }),
  )!
  assert.deepEqual(toToolEvent(payload, "after").result, { ok: false, text: "falló" })
})

test("exit_code 0 es éxito", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "Bash", tool_response: { exit_code: 0, stdout: "ok" } }))!
  assert.deepEqual(toToolEvent(payload, "after").result, { ok: true, text: "ok" })
})

test("en fase before no se mira el resultado", () => {
  const payload = parsePayload(JSON.stringify({ tool_name: "Bash", tool_response: { is_error: true } }))!
  assert.equal(toToolEvent(payload, "before").result, undefined)
})
