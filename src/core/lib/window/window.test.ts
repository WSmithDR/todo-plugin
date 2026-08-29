import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isWindowOpen, openWindow, WINDOW_MINUTES, windowPath } from "./window.ts"

function withCache<T>(fn: (env: Record<string, string>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-window-"))
  try {
    return fn({ XDG_CACHE_HOME: dir })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("sin sentinela la ventana está cerrada (fail-closed)", () => {
  withCache((env) => assert.equal(isWindowOpen(env), false))
})

test("open() crea el sentinela y abre la ventana", () => {
  withCache((env) => {
    openWindow(env)
    assert.ok(statSync(windowPath(env)).isFile())
    assert.equal(isWindowOpen(env), true)
  })
})

test("una ventana más vieja que WINDOW_MINUTES está cerrada", () => {
  withCache((env) => {
    openWindow(env)
    const old = new Date(Date.now() - (WINDOW_MINUTES + 1) * 60_000)
    utimesSync(windowPath(env), old, old)
    assert.equal(isWindowOpen(env), false)
  })
})

test("open() sobre un sentinela viejo lo reabre", () => {
  withCache((env) => {
    openWindow(env)
    const old = new Date(Date.now() - 60 * 60_000)
    utimesSync(windowPath(env), old, old)
    assert.equal(isWindowOpen(env), false)

    openWindow(env)
    assert.equal(isWindowOpen(env), true)
  })
})

test("el borde se evalúa contra el `now` inyectado", () => {
  withCache((env) => {
    openWindow(env)
    const justInside = Date.now() + WINDOW_MINUTES * 60_000 - 1_000
    const justOutside = Date.now() + WINDOW_MINUTES * 60_000 + 1_000
    assert.equal(isWindowOpen(env, justInside), true)
    assert.equal(isWindowOpen(env, justOutside), false)
  })
})
