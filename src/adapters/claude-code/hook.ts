#!/usr/bin/env node
// Entrypoint de los hooks de Claude Code. Un solo archivo, cuatro modos:
//
//   hook.ts session-start
//   hook.ts pre-tool-use
//   hook.ts post-tool-use
//   hook.ts session-end
//
// Lo invoca hooks/hooks.json a través de bin/run.sh, que elige el runtime.
import { readStdin } from "./context.ts"
import { decide, type Mode } from "./decide.ts"
import { emit } from "./emit.ts"

const MODES: Mode[] = ["session-start", "pre-tool-use", "post-tool-use", "session-end"]

const mode = process.argv[2]
if (!MODES.includes(mode as Mode)) {
  process.stderr.write(`uso: hook.ts {${MODES.join("|")}}\n`)
  process.exit(1)
}

emit(decide(await readStdin(), mode as Mode))
