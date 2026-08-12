import { test } from "node:test"
import assert from "node:assert/strict"
import { postCommitReview } from "./post-commit.ts"

const base = {
  hasTodoDir: true,
  preCommitRan: false,
  reflogSubject: "commit: fix: algo",
  subject: "fix: algo",
  unregistered: [] as string[],
}

const messageOf = (input: Parameters<typeof postCommitReview>[0]): string => {
  const d = postCommitReview(input)
  return d.action === "advise" ? d.message : ""
}

test("sin .todo/ → allow", () => {
  assert.equal(postCommitReview({ ...base, hasTodoDir: false }).action, "allow")
})

test("la revisión se vio → silencio, aunque el commit se haya forzado después", () => {
  assert.equal(
    postCommitReview({ ...base, preCommitRan: true }).action,
    "allow",
    "el advise del pre-commit aborta el commit: forzarlo después de leerlo es el camino sancionado",
  )
})

test("sin la marca del pre-commit → advise: el commit se forzó de entrada", () => {
  const message = messageOf(base)
  assert.match(message, /TODO-POST-COMMIT/)
  assert.match(message, /--no-verify/)
  assert.match(message, /fix: algo/)
})

test("un amend no vuelve a avisar: el commit original ya se revisó", () => {
  assert.equal(
    postCommitReview({ ...base, reflogSubject: "commit (amend): fix: algo" }).action,
    "allow",
    "si no, el autobump de versión dispara un aviso por commit",
  )
})

test("rebase/merge/revert tampoco avisan", () => {
  for (const subject of ["rebase (pick): x", "merge main: Fast-forward", "revert: x"]) {
    assert.equal(postCommitReview({ ...base, reflogSubject: subject }).action, "allow", subject)
  }
})

test("retroactivo: lista los commits sin registro desde el último cierre", () => {
  const message = messageOf({ ...base, unregistered: ["aaa1 fix: uno", "bbb2 feat: dos"] })
  assert.match(message, /Commits sin registro desde el último cierre \(2\)/)
  assert.match(message, /aaa1 fix: uno/)
  assert.match(message, /bbb2 feat: dos/)
})

test("la lista retroactiva se recorta a 10 pero reporta el total", () => {
  const unregistered = Array.from({ length: 14 }, (_, i) => `sha${i} commit ${i}`)
  const message = messageOf({ ...base, unregistered })
  assert.match(message, /\(14\)/)
  assert.match(message, /sha9 commit 9/)
  assert.doesNotMatch(message, /sha10 commit 10/)
  assert.match(message, /y 4 más/)
})
