import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lastSeenHead, markAdvisedOnce, rememberHead } from "./session-state.ts"

function withCache<T>(fn: (env: Record<string, string>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-state-"))
  try {
    return fn({ XDG_CACHE_HOME: dir })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("sin estado previo el HEAD es vacío", () => {
  withCache((env) => assert.equal(lastSeenHead("/p", env), ""))
})

test("el HEAD se recuerda por proyecto", () => {
  withCache((env) => {
    rememberHead("/p/uno", "aaa", env)
    rememberHead("/p/dos", "bbb", env)
    assert.equal(lastSeenHead("/p/uno", env), "aaa")
    assert.equal(lastSeenHead("/p/dos", env), "bbb")
  })
})

test("el último recordado gana", () => {
  withCache((env) => {
    rememberHead("/p", "aaa", env)
    rememberHead("/p", "bbb", env)
    assert.equal(lastSeenHead("/p", env), "bbb")
  })
})

test("markAdvisedOnce devuelve true una sola vez", () => {
  withCache((env) => {
    assert.equal(markAdvisedOnce("/p", "Una tarea", env), true)
    assert.equal(markAdvisedOnce("/p", "Una tarea", env), false)
    assert.equal(markAdvisedOnce("/p", "Otra tarea", env), true)
  })
})

test("lo avisado es por proyecto", () => {
  withCache((env) => {
    markAdvisedOnce("/p/uno", "Tarea", env)
    assert.equal(markAdvisedOnce("/p/dos", "Tarea", env), true)
  })
})

// Perder el cache tiene que costar un aviso repetido, no un error.
// El path cuelga de /dev/null, así que el mkdir falla con ENOTDIR al instante.
test("un cache irrecuperable no rompe", () => {
  const env = { XDG_CACHE_HOME: "/dev/null/imposible" }
  assert.doesNotThrow(() => rememberHead("/p", "aaa", env))
  assert.equal(lastSeenHead("/p", env), "")
  assert.doesNotThrow(() => markAdvisedOnce("/p", "x", env))
})
