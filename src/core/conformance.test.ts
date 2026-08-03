import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PLUGIN_ROOT } from "./paths.ts"
import {
  checkDeclaredPaths,
  checkHooks,
  checkManifests,
  checkRuntime,
  checkSkillPreamble,
  checkSkillsAndAgents,
  declaredVersion,
  worstStatus,
  type Check,
} from "./conformance.ts"

// Lo que importa de estos tests no es que el plugin real pase —eso lo dice
// `todo-health`— sino que el check FALLE cuando algo está mal declarado. Un
// conformance que nunca falla es decorativo, que es exactamente el estado del
// --check de ankify: escrito, correcto, y sin CI que lo corra.

/** Un root de mentira, con lo mínimo para que los checks tengan qué mirar. */
function fakeRoot(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "todo-conf-"))
  const files: Record<string, string> = {
    "cli-config.yaml": 'plugin:\n  name: x\n  version: "1.2.3"\n',
    ".claude-plugin/plugin.json": JSON.stringify({ version: "1.2.3", skills: "./skills/" }),
    ".claude-plugin/marketplace.json": JSON.stringify({
      metadata: { version: "1.2.3" },
      plugins: [{ version: "1.2.3" }],
    }),
    "opencode.json": JSON.stringify({ skills: { paths: ["./skills/"] }, plugin: ["./p.ts"] }),
    "hooks/hooks.json": JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "bash ${CLAUDE_PLUGIN_ROOT}/bin/run.sh" }] }] } }),
    "bin/run.sh": "#!/usr/bin/env bash\n",
    "p.ts": "export default 1\n",
    "skills/.keep": "",
    ...overrides,
  }
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, content)
  }
  return root
}

function withRoot(overrides: Record<string, string>, fn: (root: string) => void): void {
  const root = fakeRoot(overrides)
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const failures = (checks: Check[]): string[] => checks.filter((c) => c.status === "fail").map((c) => c.detail)

// ── versiones ──────────────────────────────────────────────────────────────

test("un root coherente pasa las verificaciones estáticas", () => {
  withRoot({}, (root) => {
    assert.equal(declaredVersion(root), "1.2.3")
    assert.deepEqual(failures(checkManifests(root)), [])
    assert.deepEqual(failures(checkDeclaredPaths(root)), [])
    assert.deepEqual(failures(checkHooks(root)), [])
  })
})

test("detecta el drift de versión — el bug real de marketplace.json", () => {
  withRoot(
    {
      ".claude-plugin/marketplace.json": JSON.stringify({
        metadata: { version: "1.0.0" },
        plugins: [{ version: "1.0.0" }],
      }),
    },
    (root) => {
      const detalles = failures(checkManifests(root))
      assert.equal(detalles.length, 1)
      assert.match(detalles[0]!, /1\.2\.3/)
      assert.match(detalles[0]!, /1\.0\.0/)
    },
  )
})

test("un manifiesto declarado y ausente falla", () => {
  const root = fakeRoot()
  try {
    rmSync(join(root, ".claude-plugin/marketplace.json"))
    assert.ok(failures(checkManifests(root)).some((d) => /no está en disco/.test(d)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ── rutas declaradas ───────────────────────────────────────────────────────

test("una ruta declarada que no existe falla — el caso agents/ de ankify", () => {
  withRoot({ ".claude-plugin/plugin.json": JSON.stringify({ version: "1.2.3", skills: "./no-existe/" }) }, (root) => {
    assert.ok(failures(checkDeclaredPaths(root)).some((d) => /no-existe/.test(d)))
  })
})

test("un plugin de OpenCode declarado y ausente falla", () => {
  withRoot({ "opencode.json": JSON.stringify({ plugin: ["./fantasma.ts"] }) }, (root) => {
    assert.ok(failures(checkDeclaredPaths(root)).some((d) => /fantasma/.test(d)))
  })
})

// ── hooks ──────────────────────────────────────────────────────────────────

test("hooks.json vacío falla — el estado de ankify", () => {
  withRoot({ "hooks/hooks.json": JSON.stringify({ hooks: {} }) }, (root) => {
    assert.ok(failures(checkHooks(root)).some((d) => /no está cableado/.test(d)))
  })
})

test("un hook que apunta a un archivo inexistente falla", () => {
  withRoot(
    {
      "hooks/hooks.json": JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ command: "bash ${CLAUDE_PLUGIN_ROOT}/bin/borrado.sh" }] }] },
      }),
    },
    (root) => {
      assert.ok(failures(checkHooks(root)).some((d) => /borrado\.sh/.test(d)))
    },
  )
})

// ── skills y agentes ───────────────────────────────────────────────────────

test("una skill sin description falla", () => {
  withRoot({ "skills/rota/SKILL.md": "---\nname: rota\n---\ncuerpo\n" }, (root) => {
    assert.ok(failures(checkSkillsAndAgents(root)).some((d) => /description/.test(d)))
  })
})

test("un agente sin cuerpo falla: el prompt quedaría vacío en OpenCode", () => {
  withRoot({ "agents/vacio.md": "---\nname: vacio\ndescription: x\n---\n" }, (root) => {
    assert.ok(failures(checkSkillsAndAgents(root)).some((d) => /prompt quedaría vacío/.test(d)))
  })
})

// ── preámbulo de las skills ────────────────────────────────────────────────

const PREAMBULO_OK = `---
name: x
description: y
---
\`\`\`bash
"\${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
MODE=$("\${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
\`\`\`
Escribe en .todo/TODO.md
`

test("una skill con el preámbulo en orden pasa", () => {
  withRoot({ "skills/x/SKILL.md": PREAMBULO_OK }, (root) => {
    assert.deepEqual(failures(checkSkillPreamble(root)), [])
  })
})

test("una skill que toca .todo/ sin abrir la ventana falla", () => {
  withRoot(
    {
      "skills/olvidadiza/SKILL.md": `---
name: olvidadiza
description: y
---
Escribe en .todo/TODO.md sin abrir nada.
`,
    },
    (root) => {
      assert.ok(failures(checkSkillPreamble(root)).some((d) => /se bloquea a sí misma/.test(d)))
    },
  )
})

test("abrir la ventana DESPUÉS de usar el store falla: create escribe un .todo/", () => {
  withRoot(
    {
      "skills/tarde/SKILL.md": `---
name: tarde
description: y
---
MODE=$("\${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
"\${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
`,
    },
    (root) => {
      assert.ok(failures(checkSkillPreamble(root)).some((d) => /recién en la/.test(d)))
    },
  )
})

test("una skill de solo lectura no necesita abrir nada", () => {
  withRoot(
    {
      "skills/lectora/SKILL.md": `---
name: lectora
description: y
---
Solo muestra información.
`,
    },
    (root) => {
      assert.deepEqual(failures(checkSkillPreamble(root)), [])
    },
  )
})

test("un agente que usa el store también tiene que abrir la ventana", () => {
  withRoot(
    {
      "agents/flojo.md": `---
name: flojo
description: y
---
Corré "\${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode
`,
    },
    (root) => {
      assert.ok(failures(checkSkillPreamble(root)).some((d) => /se bloquea a sí misma/.test(d)))
    },
  )
})

test("las 11 skills y los 2 agentes reales tienen el preámbulo en orden", () => {
  assert.deepEqual(failures(checkSkillPreamble(PLUGIN_ROOT)), [])
})

// ── el plugin real ─────────────────────────────────────────────────────────

test("runtime disponible", () => {
  assert.notEqual(checkRuntime().status, "fail")
})

test("el plugin real no tiene fallas estáticas", () => {
  const checks = [
    ...checkManifests(PLUGIN_ROOT),
    ...checkDeclaredPaths(PLUGIN_ROOT),
    ...checkHooks(PLUGIN_ROOT),
    ...checkSkillsAndAgents(PLUGIN_ROOT),
  ]
  assert.deepEqual(failures(checks), [])
  assert.notEqual(worstStatus(checks), "fail")
})
