import { test } from "node:test"
import assert from "node:assert/strict"
import { branchDoing } from "./branch-doing.ts"
import type { ToolEvent } from "../../protocol.ts"

const ran = (command: string): ToolEvent => ({
  phase: "after",
  kind: "bash",
  paths: [],
  contents: [],
  command,
  cwd: "/proj",
  result: { ok: true, text: "" },
})

const on = (branch: string) => ({ hasTodoDir: true, branch })

test("checkout -b a una feature → advise", () => {
  const d = branchDoing(ran("git checkout -b feat/x"), on("feat/x"))
  assert.equal(d.action, "advise")
  assert.match(d.action === "advise" ? d.message : "", /TODO-DOING/)
})

test("git switch también dispara", () => {
  assert.equal(branchDoing(ran("git switch feat/x"), on("feat/x")).action, "advise")
})

test("en una rama base → allow", () => {
  for (const branch of ["main", "master", "develop"]) {
    assert.equal(branchDoing(ran("git switch " + branch), on(branch)).action, "allow", branch)
  }
})

test("HEAD detached → allow", () => {
  assert.equal(branchDoing(ran("git checkout -b x"), on("HEAD")).action, "allow")
})

test("sin .todo/ → allow", () => {
  assert.equal(branchDoing(ran("git switch feat/x"), { hasTodoDir: false, branch: "feat/x" }).action, "allow")
})

test("checkout de un ARCHIVO no cambia de rama → allow", () => {
  assert.equal(branchDoing(ran("git checkout src/x.js"), on("feat/x")).action, "allow")
})

test("git branch crea sin moverse → allow", () => {
  assert.equal(branchDoing(ran("git branch feat/y"), on("feat/x")).action, "allow")
})

test("la rama va en el mensaje", () => {
  const d = branchDoing(ran("git switch feat/importante"), on("feat/importante"))
  assert.match(d.action === "advise" ? d.message : "", /feat\/importante/)
})
