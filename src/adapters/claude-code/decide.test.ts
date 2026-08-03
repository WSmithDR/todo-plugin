import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decide } from "./decide.ts"
import { openWindow } from "../../core/window.ts"

// Cobertura de los tres modos que antes vivía en bin/dev/test-hooks.sh, cuando
// cada regla era un script de bash aparte que se spawneaba por caso.

// decide() consulta la ventana REAL: sin esto el resultado depende de si alguien
// corrió un skill en los últimos 10 minutos, y el test pasa o falla según la
// hora. Se apunta el cache a un temp vacío = ventana cerrada.
const CACHE = mkdtempSync(join(tmpdir(), "todo-decide-cache-"))
process.env.XDG_CACHE_HOME = CACHE
process.on("exit", () => rmSync(CACHE, { recursive: true, force: true }))

function withProject<T>(fn: (cwd: string) => T, opts: { todo?: boolean; config?: boolean } = {}): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-decide-"))
  try {
    if (opts.todo !== false) mkdirSync(join(dir, ".todo"), { recursive: true })
    if (opts.config) writeFileSync(join(dir, ".todo", "config.json"), "{}")
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const payload = (value: unknown): string => JSON.stringify(value)

// ── fail-open ──────────────────────────────────────────────────────────────

test("un payload ilegible deja pasar en los cuatro modos", () => {
  for (const mode of ["pre-tool-use", "post-tool-use", "session-start", "session-end"] as const) {
    assert.equal(decide("no soy json", mode).action, "allow", mode)
    assert.equal(decide("", mode).action, "allow", mode)
  }
})

// ── session-end ────────────────────────────────────────────────────────────

test("session-end sin commits desde el arranque → allow", () => {
  withProject((cwd) => {
    writeFileSync(join(cwd, ".todo", "DOING.md"), "- [ ] **Una tarea** — en curso\n")
    // session-start ancla el HEAD; sin commits en el medio, no avisa.
    decide(payload({ cwd }), "session-start")
    assert.equal(decide(payload({ cwd }), "session-end").action, "allow")
  })
})

test("session-end sin DOING → allow", () => {
  withProject((cwd) => {
    assert.equal(decide(payload({ cwd }), "session-end").action, "allow")
  })
})

// ── session-start ──────────────────────────────────────────────────────────

test("session-start sin .todo/ → allow", () => {
  withProject((cwd) => assert.equal(decide(payload({ cwd }), "session-start").action, "allow"), { todo: false })
})

test("session-start con .todo/ sin config → avisa", () => {
  withProject((cwd) => {
    const d = decide(payload({ cwd }), "session-start")
    assert.match(d.action === "advise" ? d.message : "", /TODO-CONFIG-MISSING/)
  })
})

test("session-start con config → allow (sin .git no hay hook que instalar)", () => {
  withProject((cwd) => assert.equal(decide(payload({ cwd }), "session-start").action, "allow"), { config: true })
})

// ── post-tool-use ──────────────────────────────────────────────────────────

test("post: comando exitoso → allow", () => {
  withProject((cwd) => {
    const d = decide(
      payload({ cwd, tool_name: "Bash", tool_input: { command: "npm run build" }, tool_response: { exit_code: 0 } }),
      "post-tool-use",
    )
    assert.equal(d.action, "allow")
  })
})

test("post: comando fallido → advise", () => {
  withProject((cwd) => {
    const d = decide(
      payload({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "npm run build" },
        tool_response: { exit_code: 1, stderr: "boom" },
      }),
      "post-tool-use",
    )
    assert.match(d.action === "advise" ? d.message : "", /TODO-ERROR-CHECKER/)
  })
})

test("post: sin .todo/ → allow aunque falle", () => {
  withProject(
    (cwd) => {
      const d = decide(
        payload({ cwd, tool_name: "Bash", tool_input: { command: "npm x" }, tool_response: { exit_code: 1 } }),
        "post-tool-use",
      )
      assert.equal(d.action, "allow")
    },
    { todo: false },
  )
})

test("post: las dos reglas corren en el mismo proceso y se mergean", () => {
  withProject((cwd) => {
    // Un `git switch` que además falla dispara error-triage Y branch-doing.
    const d = decide(
      payload({
        cwd,
        tool_name: "Bash",
        tool_input: { command: "git switch feat/x" },
        tool_response: { exit_code: 1, stderr: "boom" },
      }),
      "post-tool-use",
    )
    assert.equal(d.action, "advise")
    // Sin repo git la rama sale vacía, así que branch-doing calla; lo que se
    // verifica acá es que el merge no pierda el aviso que SÍ hay.
    assert.match(d.action === "advise" ? d.message : "", /TODO-ERROR-CHECKER/)
  })
})

// ── pre-tool-use ───────────────────────────────────────────────────────────

test("pre: Edit sobre .todo sin ventana → deny", () => {
  const d = decide(payload({ tool_name: "Edit", tool_input: { file_path: "/p/.todo/TODO.md" } }), "pre-tool-use")
  assert.equal(d.action, "deny")
})

test("pre: Edit fuera de .todo → allow", () => {
  const d = decide(payload({ tool_name: "Edit", tool_input: { file_path: "/p/src/x.ts" } }), "pre-tool-use")
  assert.equal(d.action, "allow")
})

test("pre: '- [x]' a mano → deny con el mensaje del guard duro", () => {
  const d = decide(
    payload({ tool_name: "Write", tool_input: { file_path: "/p/.todo/DOING.md", content: "- [x] listo" } }),
    "pre-tool-use",
  )
  assert.match(d.action === "deny" ? d.message : "", /todo-done/)
})

// Va último: abre la ventana de verdad y no se puede volver atrás dentro del
// mismo proceso sin esperar 10 minutos.
test("pre: con la ventana abierta → allow", () => {
  openWindow()
  const d = decide(payload({ tool_name: "Edit", tool_input: { file_path: "/p/.todo/TODO.md" } }), "pre-tool-use")
  assert.equal(d.action, "allow")
})

test("pre: la ventana NO autoriza un '- [x]'", () => {
  openWindow()
  const d = decide(
    payload({ tool_name: "Edit", tool_input: { file_path: "/p/.todo/TODO.md", new_string: "- [x] listo" } }),
    "pre-tool-use",
  )
  assert.equal(d.action, "deny")
})
