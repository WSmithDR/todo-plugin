import { test } from "node:test"
import assert from "node:assert/strict"
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sessionSetup } from "./session-setup.ts"

/** Un plugin de mentira con el pre-commit.sh en su lugar. */
function fakePluginRoot(dir: string): string {
  const root = join(dir, "plugin")
  mkdirSync(join(root, "bin", "hooks"), { recursive: true })
  writeFileSync(join(root, "bin", "hooks", "pre-commit.sh"), "#!/bin/bash\nexit 0\n")
  return root
}

function withProject<T>(
  fn: (ctx: { cwd: string; pluginRoot: string; hookPath: string }) => T,
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
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("sin .todo/ no hace nada", () => {
  withProject(
    ({ cwd, pluginRoot }) => assert.equal(sessionSetup({ cwd, pluginRoot }).action, "allow"),
    { todo: false },
  )
})

test("instala el git hook y avisa que falta config", () => {
  withProject(({ cwd, pluginRoot, hookPath }) => {
    const d = sessionSetup({ cwd, pluginRoot })
    assert.equal(readlinkSync(hookPath), join(pluginRoot, "bin", "hooks", "pre-commit.sh"))

    const message = d.action === "advise" ? d.message : ""
    assert.match(message, /TODO-SETUP/)
    assert.match(message, /TODO-CONFIG-MISSING/, "los dos avisos tienen que llegar, no solo uno")
  })
})

test("con config.json solo avisa la instalación del hook", () => {
  withProject(
    ({ cwd, pluginRoot }) => {
      const message = (() => {
        const d = sessionSetup({ cwd, pluginRoot })
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
    ({ cwd, pluginRoot }) => {
      sessionSetup({ cwd, pluginRoot })
      assert.equal(sessionSetup({ cwd, pluginRoot }).action, "allow")
    },
    { config: true },
  )
})

test("un pre-commit ajeno NO se pisa: se avisa", () => {
  withProject(
    ({ cwd, pluginRoot, hookPath }) => {
      const ajeno = join(cwd, "otro-hook.sh")
      writeFileSync(ajeno, "#!/bin/bash\nexit 0\n")
      symlinkSync(ajeno, hookPath)

      const d = sessionSetup({ cwd, pluginRoot })
      assert.equal(readlinkSync(hookPath), ajeno, "el hook ajeno tiene que sobrevivir")
      assert.match(d.action === "advise" ? d.message : "", /ya existe y no es el del plugin/)
    },
    { config: true },
  )
})

test("un pre-commit ajeno que es archivo regular tampoco se pisa", () => {
  withProject(
    ({ cwd, pluginRoot, hookPath }) => {
      writeFileSync(hookPath, "#!/bin/bash\nexit 0\n")
      sessionSetup({ cwd, pluginRoot })
      assert.equal(lstatSync(hookPath).isSymbolicLink(), false)
    },
    { config: true },
  )
})

test("sin .git/ no intenta instalar nada", () => {
  withProject(
    ({ cwd, pluginRoot }) => {
      const d = sessionSetup({ cwd, pluginRoot })
      assert.match(d.action === "advise" ? d.message : "", /TODO-CONFIG-MISSING/)
      assert.doesNotMatch(d.action === "advise" ? d.message : "", /TODO-SETUP/)
    },
    { git: false },
  )
})
