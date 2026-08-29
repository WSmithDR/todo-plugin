import { test } from "node:test"
import assert from "node:assert/strict"
import { guard } from "./guard.ts"
import type { ToolEvent, ToolKind } from "../../lib/protocol/protocol.ts"

// Los casos son el port de bin/dev/test-guard.sh, que probaba el mismo
// comportamiento spawneando bash + python3. Acá la regla es pura: no toca disco,
// no spawnea nada, y la ventana entra como booleano.

const fileEvent = (kind: ToolKind, path: string, contents: string[] = []): ToolEvent => ({
  phase: "before",
  kind,
  paths: [path],
  contents,
  cwd: "/proj",
})

const bashEvent = (command: string): ToolEvent => ({
  phase: "before",
  kind: "bash",
  paths: [],
  contents: [],
  command,
  cwd: "/proj",
})

const OPEN = { windowOpen: true, enabled: true }
const CLOSED = { windowOpen: false, enabled: true }
const OFF = { windowOpen: false, enabled: false }

test("Edit sobre .todo sin ventana → deny", () => {
  const d = guard(fileEvent("edit", "/proj/.todo/TODO.md"), CLOSED)
  assert.equal(d.action, "deny")
})

test("Edit sobre .todo con ventana → allow", () => {
  assert.equal(guard(fileEvent("edit", "/proj/.todo/TODO.md"), OPEN).action, "allow")
})

test("Edit fuera de .todo → allow aunque no haya ventana", () => {
  assert.equal(guard(fileEvent("edit", "/proj/src/x.js"), CLOSED).action, "allow")
})

test("MultiEdit sobre .todo sin ventana → deny", () => {
  assert.equal(guard(fileEvent("multiedit", "/proj/.todo/DOING.md"), CLOSED).action, "deny")
})

test("bypass TODO_GUARD=off → allow", () => {
  assert.equal(guard(fileEvent("edit", "/proj/.todo/TODO.md"), OFF).action, "allow")
})

test("path relativo también matchea", () => {
  assert.equal(guard(fileEvent("write", ".todo/TODO.md"), CLOSED).action, "deny")
})

test("path con barras de Windows también matchea", () => {
  assert.equal(guard(fileEvent("write", "C:\\proj\\.todo\\TODO.md"), CLOSED).action, "deny")
})

// ── bash: escribir vs solo leer ────────────────────────────────────────────

test("sed -i sobre .todo sin ventana → deny", () => {
  assert.equal(guard(bashEvent("sed -i s/a/b/ .todo/TODO.md"), CLOSED).action, "deny")
})

test("cat .todo → allow (leer no es escribir)", () => {
  assert.equal(guard(bashEvent("cat .todo/TODO.md"), CLOSED).action, "allow")
})

test("lectura con redirect FUERA de .todo → allow", () => {
  assert.equal(guard(bashEvent("grep foo .todo/TODO.md > /tmp/out.txt"), CLOSED).action, "allow")
})

test("cat .todo con 2>/dev/null → allow", () => {
  assert.equal(guard(bashEvent("cat .todo/TODO.md 2>/dev/null"), CLOSED).action, "allow")
})

test("redirect HACIA .todo sin ventana → deny", () => {
  assert.equal(guard(bashEvent("echo x > .todo/TODO.md"), CLOSED).action, "deny")
})

test("bash que no menciona .todo → allow", () => {
  assert.equal(guard(bashEvent("rm -rf /tmp/basura"), CLOSED).action, "allow")
})

// Un `<placeholder>` seguido de la ruta contiene la secuencia `>/.todo/`, que la
// rama del redirect leía como escritura. Bloqueaba comandos cuyo único pecado era
// NOMBRAR la ruta — pasó de verdad, escribiendo la documentación del guard.
test("un <placeholder> antes de .todo no es un redirect", () => {
  const commit = 'git commit -m "create escribe un <id>/.todo/config.json"'
  assert.equal(guard(bashEvent(commit), CLOSED).action, "allow")
})

test("un placeholder con espacios tampoco", () => {
  const cmd = 'echo "el store guarda <nombre del proyecto>/.todo/TODO.md"'
  assert.equal(guard(bashEvent(cmd), CLOSED).action, "allow")
})

// Segunda clase de falso positivo, también observada de verdad: un sed sobre un
// archivo ajeno cuyo SCRIPT menciona la ruta. La escritura tiene que APUNTAR a
// .todo/, no solo nombrarlo.
test("sed -i sobre otro archivo, mencionando .todo en el script → allow", () => {
  const cmd = "sed -i 's|de `.todo/` salvo|de `.todo/` excepto|' CLAUDE.md"
  assert.equal(guard(bashEvent(cmd), CLOSED).action, "allow")
})

test("sed -i que SÍ apunta a .todo → deny", () => {
  assert.equal(guard(bashEvent('sed -i "s/a/b/" .todo/TODO.md'), CLOSED).action, "deny")
})

test("rm/cp/mv sobre .todo → deny", () => {
  for (const cmd of ["rm .todo/TODO.md", "cp x .todo/TODO.md", "mv .todo/TODO.md /tmp/"]) {
    assert.equal(guard(bashEvent(cmd), CLOSED).action, "deny", cmd)
  }
})

test("rm sobre otra cosa, aunque el comando nombre .todo → allow", () => {
  assert.equal(guard(bashEvent('rm /tmp/x  # nada que ver con .todo/'), CLOSED).action, "allow")
})

// El fix descarta placeholders, no relaja el redirect: las escrituras de verdad
// se siguen bloqueando, con y sin espacio.
test("el redirect real sigue bloqueado, con y sin espacio", () => {
  assert.equal(guard(bashEvent("echo x > .todo/TODO.md"), CLOSED).action, "deny")
  assert.equal(guard(bashEvent("echo x>.todo/TODO.md"), CLOSED).action, "deny")
  assert.equal(guard(bashEvent("echo x >> .todo/DOING.md"), CLOSED).action, "deny")
})

test("el mensaje explica que el prefijo por comando no sirve", () => {
  const d = guard(bashEvent("sed -i s/a/b/ .todo/TODO.md"), CLOSED)
  assert.match(d.action === "deny" ? d.message : "", /prefijo por comando/)
})

// ── Guard duro: '- [x]' a mano ─────────────────────────────────────────────
// No lo cubría test-guard.sh, y es la regla que la ventana NO puede autorizar.

test("'- [x]' en TODO.md → deny incluso con la ventana abierta", () => {
  const event = fileEvent("edit", "/proj/.todo/TODO.md", ["- [x] **Algo** — listo"])
  const d = guard(event, OPEN)
  assert.equal(d.action, "deny")
  assert.match(d.action === "deny" ? d.message : "", /todo-done/)
})

test("'- [x]' en DOING.md → deny", () => {
  assert.equal(guard(fileEvent("write", "/proj/.todo/DOING.md", ["  - [x] x"]), OPEN).action, "deny")
})

test("'- [x]' en DONE.md → permitido con ventana (ahí SÍ va)", () => {
  assert.equal(guard(fileEvent("write", "/proj/.todo/DONE.md", ["- [x] x"]), OPEN).action, "allow")
})

test("'- [ ]' sin marcar en TODO.md → allow con ventana", () => {
  assert.equal(guard(fileEvent("edit", "/proj/.todo/TODO.md", ["- [ ] pendiente"]), OPEN).action, "allow")
})
