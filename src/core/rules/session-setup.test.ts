import { test } from "node:test"
import assert from "node:assert/strict"
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GIT_HOOKS, sessionSetup } from "./session-setup.ts"

/** Un plugin de mentira con sus shims de git hooks en su lugar. */
function fakePluginRoot(dir: string): string {
  const root = join(dir, "plugin")
  mkdirSync(join(root, "bin", "hooks"), { recursive: true })
  for (const name of GIT_HOOKS) {
    writeFileSync(join(root, "bin", "hooks", `${name}.sh`), "#!/bin/bash\nexit 0\n")
  }
  return root
}

function withProject<T>(
  fn: (ctx: { cwd: string; pluginRoot: string; hookPath: string; env: Record<string, string> }) => T,
  opts: { todo?: boolean; git?: boolean; config?: boolean } = {},
): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-session-"))
  try {
    const cwd = join(dir, "proj")
    mkdirSync(cwd, { recursive: true })
    if (opts.todo !== false) mkdirSync(join(cwd, ".todo"), { recursive: true })
    if (opts.git !== false) mkdirSync(join(cwd, ".git", "hooks"), { recursive: true })
    if (opts.config) writeFileSync(join(cwd, ".todo", "config.json"), "{}")

    return fn({
      cwd,
      pluginRoot: fakePluginRoot(dir),
      hookPath: join(cwd, ".git", "hooks", "pre-commit"),
      // Sin esto, los casos sin `.todo/` entran a la rama del store y leen el
      // registro REAL del usuario: le consumen el aviso del día y el test pasa
      // o falla según lo que él tenga hoy. Ya pasó.
      env: { HOME: dir, XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache") },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("sin .todo/ no hace nada", () => {
  withProject(
    ({ cwd, pluginRoot, env }) => assert.equal(sessionSetup({ cwd, pluginRoot, env }).action, "allow"),
    { todo: false },
  )
})

test("instala el git hook y avisa que falta config", () => {
  withProject(({ cwd, pluginRoot, hookPath, env }) => {
    const d = sessionSetup({ cwd, pluginRoot, env })
    assert.equal(readlinkSync(hookPath), join(pluginRoot, "bin", "hooks", "pre-commit.sh"))

    const message = d.action === "advise" ? d.message : ""
    assert.match(message, /TODO-SETUP/)
    assert.match(message, /TODO-CONFIG-MISSING/, "los dos avisos tienen que llegar, no solo uno")
  })
})

test("con config.json solo avisa la instalación del hook", () => {
  withProject(
    ({ cwd, pluginRoot, env }) => {
      const message = (() => {
        const d = sessionSetup({ cwd, pluginRoot, env })
        return d.action === "advise" ? d.message : ""
      })()
      assert.match(message, /TODO-SETUP/)
      assert.doesNotMatch(message, /TODO-CONFIG-MISSING/)
    },
    { config: true },
  )
})

test("el hook ya instalado no se reinstala ni se reporta", () => {
  withProject(
    ({ cwd, pluginRoot, env }) => {
      sessionSetup({ cwd, pluginRoot, env })
      assert.equal(sessionSetup({ cwd, pluginRoot, env }).action, "allow")
    },
    { config: true },
  )
})

test("un pre-commit ajeno se ENCADENA: pasa a .local y el del plugin toma el slot", () => {
  withProject(
    ({ cwd, pluginRoot, hookPath, env }) => {
      const ajeno = join(cwd, "otro-hook.sh")
      writeFileSync(ajeno, "#!/bin/bash\nexit 0\n")
      symlinkSync(ajeno, hookPath)

      const d = sessionSetup({ cwd, pluginRoot, env })
      assert.equal(readlinkSync(hookPath), join(pluginRoot, "bin", "hooks", "pre-commit.sh"))
      assert.equal(readlinkSync(`${hookPath}.local`), ajeno, "el hook ajeno sigue existiendo, encadenado")
      assert.match(d.action === "advise" ? d.message : "", /se movió a pre-commit\.local/)
    },
    { config: true },
  )
})

test("un pre-commit ajeno que es archivo regular también se encadena", () => {
  withProject(
    ({ cwd, pluginRoot, hookPath, env }) => {
      writeFileSync(hookPath, "#!/bin/bash\necho ajeno\n")
      sessionSetup({ cwd, pluginRoot, env })
      assert.equal(lstatSync(hookPath).isSymbolicLink(), true)
      assert.match(readFileSync(`${hookPath}.local`, "utf8"), /echo ajeno/)
    },
    { config: true },
  )
})

test("si ya hay un .local no se toca nada: la cadena de tres se resuelve a mano", () => {
  withProject(
    ({ cwd, pluginRoot, hookPath, env }) => {
      writeFileSync(hookPath, "#!/bin/bash\necho ajeno\n")
      writeFileSync(`${hookPath}.local`, "#!/bin/bash\necho viejo\n")

      const d = sessionSetup({ cwd, pluginRoot, env })
      assert.equal(lstatSync(hookPath).isSymbolicLink(), false, "el ajeno no se movió")
      assert.match(readFileSync(`${hookPath}.local`, "utf8"), /echo viejo/, "el .local previo se conserva")
      assert.match(d.action === "advise" ? d.message : "", /ya hay un pre-commit\.local/)
    },
    { config: true },
  )
})

test("se instalan los dos hooks, no solo el pre-commit", () => {
  withProject(
    ({ cwd, pluginRoot, env }) => {
      sessionSetup({ cwd, pluginRoot, env })
      for (const name of GIT_HOOKS) {
        assert.equal(
          readlinkSync(join(cwd, ".git", "hooks", name)),
          join(pluginRoot, "bin", "hooks", `${name}.sh`),
          `${name} tiene que quedar instalado`,
        )
      }
    },
    { config: true },
  )
})

test("sin .git/ no intenta instalar nada", () => {
  withProject(
    ({ cwd, pluginRoot, env }) => {
      const d = sessionSetup({ cwd, pluginRoot, env })
      assert.match(d.action === "advise" ? d.message : "", /TODO-CONFIG-MISSING/)
      assert.doesNotMatch(d.action === "advise" ? d.message : "", /TODO-SETUP/)
    },
    { git: false },
  )
})
