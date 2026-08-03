import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PLUGIN_ROOT } from "../../core/paths.ts"
import { openWindow } from "../../core/window.ts"
import { createHooks } from "./plugin.ts"

// La ventana del guard es real; sin aislar el cache el resultado depende de si
// alguien corrió un skill en los últimos 10 minutos.
const CACHE = mkdtempSync(join(tmpdir(), "todo-oc-cache-"))
process.env.XDG_CACHE_HOME = CACHE
process.on("exit", () => rmSync(CACHE, { recursive: true, force: true }))

function withProject<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-oc-"))
  try {
    mkdirSync(join(dir, ".todo"), { recursive: true })
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("están los cinco hooks de la paridad", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)
    for (const name of [
      "shell.env",
      "config",
      "tool.execute.before",
      "tool.execute.after",
      "experimental.chat.system.transform",
    ]) {
      assert.equal(typeof (hooks as Record<string, unknown>)[name], "function", name)
    }
  })
})

test("shell.env inyecta las dos vars y no pisa a otro plugin", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)

    const output = { env: {} as Record<string, string> }
    await hooks["shell.env"](null, output)
    assert.equal(output.env.TODO_PLUGIN_ROOT, PLUGIN_ROOT)
    assert.equal(output.env.CLAUDE_PLUGIN_ROOT, PLUGIN_ROOT)

    const otro = { env: { CLAUDE_PLUGIN_ROOT: "/otro/plugin" } as Record<string, string> }
    await hooks["shell.env"](null, otro)
    assert.equal(otro.env.CLAUDE_PLUGIN_ROOT, "/otro/plugin")
    assert.equal(otro.env.TODO_PLUGIN_ROOT, PLUGIN_ROOT)
  })
})

test("before bloquea una escritura directa a .todo/", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)
    await assert.rejects(
      () => hooks["tool.execute.before"]({ tool: "edit" }, { args: { filePath: join(dir, ".todo/TODO.md") } }),
      /TODO-GUARD/,
    )
  })
})

test("before deja pasar un archivo fuera de .todo/", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)
    await assert.doesNotReject(() =>
      hooks["tool.execute.before"]({ tool: "edit" }, { args: { filePath: join(dir, "src/x.ts") } }),
    )
  })
})

test("before bloquea un '- [x]' aunque la ventana esté abierta", async () => {
  await withProject(async (dir) => {
    openWindow()
    const hooks = createHooks(dir, PLUGIN_ROOT)
    await assert.rejects(
      () =>
        hooks["tool.execute.before"](
          { tool: "edit" },
          { args: { filePath: join(dir, ".todo/TODO.md"), newString: "- [x] listo" } },
        ),
      /todo-done/,
    )
  })
})

test("after NO cancela: anexa el aviso al output", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)
    const output = { title: "bash", output: "boom", metadata: { exit: 1 } }

    await hooks["tool.execute.after"]({ tool: "bash", args: { command: "npm run build" } }, output)
    assert.match(output.output, /TODO-ERROR-CHECKER/)
    assert.match(output.output, /boom/, "el output original tiene que seguir ahí")
  })
})

test("after deja intacto un comando exitoso", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)
    const output = { title: "bash", output: "ok", metadata: { exit: 0 } }

    await hooks["tool.execute.after"]({ tool: "bash", args: { command: "npm run build" } }, output)
    assert.equal(output.output, "ok")
  })
})

test("system.transform inyecta el índice de skills y las reglas duras", async () => {
  await withProject(async (dir) => {
    const hooks = createHooks(dir, PLUGIN_ROOT)
    const output = { system: [] as string[] }

    await hooks["experimental.chat.system.transform"](null, output)
    const all = output.system.join("\n")
    assert.match(all, /todo-add/)
    assert.match(all, /NUNCA marques `- \[x\]`/)
  })
})

test("el aviso del setup de sesión llega por el system prompt", async () => {
  await withProject(async (dir) => {
    // .todo/ sin config.json → sessionSetup pide todo-config.
    const hooks = createHooks(dir, PLUGIN_ROOT)
    const output = { system: [] as string[] }

    await hooks["experimental.chat.system.transform"](null, output)
    assert.match(output.system.join("\n"), /TODO-CONFIG-MISSING/)
  })
})
