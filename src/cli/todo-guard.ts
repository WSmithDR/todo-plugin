#!/usr/bin/env node
// Superficie que invocan las skills y los agentes:
//
//   todo-guard open     abre la ventana de escritura (primera acción de cada skill)
//   todo-guard check    modo hook — lee el payload por stdin (equivale a
//                       `hook.ts pre-tool-use`; se mantiene porque es lo que
//                       llama bin/dev/test-guard.sh y da un test end-to-end
//                       gratis de normalize + guard + emit)
import { readStdin } from "../adapters/claude-code/context.ts"
import { decide } from "../adapters/claude-code/decide.ts"
import { emit } from "../adapters/claude-code/emit.ts"
import { openWindow } from "../core/window.ts"

if ((process.argv[2] ?? "check") === "open") {
  openWindow()
  process.exit(0)
}

emit(decide(await readStdin(), "pre-tool-use"), "pre-tool-use")
