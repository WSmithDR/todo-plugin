import { test } from "node:test"
import assert from "node:assert/strict"
import { ALLOW, advise, deny } from "../../core/protocol.ts"
import { applyAfter, applyBefore, TITLE_MARK } from "./emit.ts"

test("deny en fase before cancela la tool call", () => {
  assert.throws(() => applyBefore(deny("bloqueado")), /bloqueado/)
})

test("allow en fase before no hace nada", () => {
  assert.doesNotThrow(() => applyBefore(ALLOW))
})

// La diferencia que el bridge anterior perdía: mapeaba todo exit != 0 a throw, o
// sea que un aviso post-ejecución habría cancelado el comando.
test("advise en fase after NO cancela: anexa al output", () => {
  const output = { title: "bash", output: "resultado" }
  assert.doesNotThrow(() => applyAfter(advise("ojo con esto"), output))
  assert.match(output.output, /resultado/)
  assert.match(output.output, /ojo con esto/)
})

test("advise marca el title, porque el output puede quedar plegado", () => {
  const output = { title: "bash", output: "x" }
  applyAfter(advise("aviso"), output)
  assert.ok(output.title.includes(TITLE_MARK))
})

test("el title no se marca dos veces", () => {
  const output = { title: "bash", output: "x" }
  applyAfter(advise("uno"), output)
  applyAfter(advise("dos"), output)
  assert.equal(output.title.split(TITLE_MARK).length - 1, 1)
})

test("allow en fase after deja el output intacto", () => {
  const output = { title: "bash", output: "resultado" }
  applyAfter(ALLOW, output)
  assert.equal(output.output, "resultado")
  assert.equal(output.title, "bash")
})
