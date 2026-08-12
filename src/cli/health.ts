#!/usr/bin/env node
// Health check del plugin.
//
//   todo-health            estado del plugin + del .todo/ de este proyecto
//   todo-health --strict   solo el conformance; exit 1 si algo falla (para CI)
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { PLUGIN_ROOT } from "../core/paths.ts"
import { declaredVersion, runConformance, worstStatus, type Check } from "../core/conformance.ts"
import { openItemTitles } from "../core/rules/pre-commit.ts"
import { GIT_HOOKS } from "../core/rules/session-setup.ts"
import { completedCount, readTodoFile } from "../core/todo-files.ts"
import { list, mode, projectPath } from "../core/store.ts"

const strict = process.argv.includes("--strict")

const ICON: Record<Check["status"], string> = { ok: "✓", warn: "⚠", fail: "✗" }

const checks = await runConformance(PLUGIN_ROOT)
const version = declaredVersion(PLUGIN_ROOT) ?? "desconocida"

console.log(`todo-plugin v${version} — ${PLUGIN_ROOT}\n`)
for (const check of checks) {
  console.log(`  ${ICON[check.status]} ${check.name}: ${check.detail}`)
}

if (!strict) reportProject()

const status = worstStatus(checks)
const failed = checks.filter((c) => c.status === "fail").length

console.log(
  status === "ok"
    ? "\n✓ Todo lo que el plugin declara existe y arranca."
    : status === "warn"
      ? "\n⚠ Sin fallas, con advertencias."
      : `\n✗ ${failed} verificación(es) fallaron.`,
)

// En modo normal el exit code es 0 salvo falla dura, para no romper la sesión de
// quien solo quería ver el estado. --strict es el que usa CI.
process.exit(status === "fail" ? 1 : 0)

function reportProject(): void {
  console.log("")
  if (!existsSync(".todo")) {
    reportStore()
    return
  }

  const count = (file: string): number => {
    try {
      return openItemTitles(readFileSync(join(".todo", file), "utf8")).length
    } catch {
      return 0
    }
  }
  const done = (() => {
    try {
      return readFileSync(join(".todo", "DONE.md"), "utf8").split("\n").filter((l) => l.startsWith("- [x]")).length
    } catch {
      return 0
    }
  })()

  console.log(`  · .todo/ — TODO:${count("TODO.md")}  DOING:${count("DOING.md")}  DONE:${done}`)
  reportGitHooks()

  try {
    const config = JSON.parse(readFileSync(join(".todo", "config.json"), "utf8")) as Record<string, unknown>
    console.log(`  · config: ${Object.entries(config).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}`)
  } catch {
    console.log("  ⚠ config: sin configurar — corré la skill todo-config")
  }
}

/**
 * Sin `.todo/` local puede no haber nada… o puede haber medio registro central.
 *
 * Antes acá se imprimía "no existe — se crea con el primer todo-add" sin mirar
 * el store: en una máquina con seis proyectos sin repo, la herramienta a la que
 * vas justamente cuando algo no anda te contestaba que no hay nada.
 */
function reportStore(): void {
  const projects = (() => {
    try {
      return list()
    } catch {
      return []
    }
  })()

  if (projects.length === 0) {
    console.log("  · .todo/ no existe — se crea con el primer todo-add")
    return
  }

  const modo = mode(process.cwd()) === "nonrepo" ? "acá se opera sobre el store" : "estás en un repo, así que las skills usarían su .todo/"
  console.log(`  · sin .todo/ local · registro central: ${projects.length} proyectos (${modo})`)

  for (const project of projects) {
    const dir = projectPath(project.id)
    const abiertos = openItemTitles(readTodoFile(dir, "TODO.md")).length
    const enCurso = openItemTitles(readTodoFile(dir, "DOING.md")).length
    const cerrados = completedCount(readTodoFile(dir, "DONE.md"))
    console.log(`      ${project.name.padEnd(34)} TODO:${abiertos}  DOING:${enCurso}  DONE:${cerrados}`)
  }
}

/**
 * Los git hooks se instalan solos en SessionStart, así que nadie los mira. Este
 * repo tuvo la revisión pre-commit inactiva durante meses porque el slot lo
 * ocupaba otro hook: si el health no lo reporta, no se entera nadie.
 */
function reportGitHooks(): void {
  if (!existsSync(".git")) return

  for (const name of GIT_HOOKS) {
    const dst = join(".git", "hooks", name)
    const target = (() => {
      try {
        return lstatSync(dst).isSymbolicLink() ? readlinkSync(dst) : ""
      } catch {
        return null
      }
    })()

    if (target === null) {
      console.log(`  ⚠ hook ${name}: no instalado — reabrí la sesión para que se instale`)
    } else if (target.startsWith(PLUGIN_ROOT)) {
      const chained = existsSync(`${dst}.local`) ? ` (encadena ${name}.local)` : ""
      console.log(`  ✓ hook ${name}: activo${chained}`)
    } else {
      console.log(`  ⚠ hook ${name}: el slot lo ocupa otro hook (${target || "archivo propio"}) — el del plugin NO corre`)
    }
  }
}
