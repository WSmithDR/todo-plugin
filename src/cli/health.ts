#!/usr/bin/env node
// Health check del plugin.
//
//   todo-health            estado del plugin + del .todo/ de este proyecto
//   todo-health --strict   solo el conformance; exit 1 si algo falla (para CI)
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PLUGIN_ROOT } from "../core/paths.ts"
import { declaredVersion, runConformance, worstStatus, type Check } from "../core/conformance.ts"
import { openItemTitles } from "../core/rules/pre-commit.ts"

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
    console.log("  · .todo/ no existe — se crea con el primer todo-add")
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

  try {
    const config = JSON.parse(readFileSync(join(".todo", "config.json"), "utf8")) as Record<string, unknown>
    console.log(`  · config: ${Object.entries(config).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}`)
  } catch {
    console.log("  ⚠ config: sin configurar — corré la skill todo-config")
  }
}
