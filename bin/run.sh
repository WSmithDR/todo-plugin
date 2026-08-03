#!/usr/bin/env bash
# Elige el runtime que ejecuta los .ts. No hay build ni dist/: bun los corre
# nativo y node >=22.18 les borra los tipos sin flag.
#
# bun primero porque es lo que trae OpenCode. Si no hay ninguno de los dos, el
# exec falla con 127 — non-zero pero distinto de 2, así que Claude Code lo trata
# como error del hook y NO como bloqueo: los hooks fallan abiertos.
# `todo-health` reporta la ausencia de runtime.
if command -v bun >/dev/null 2>&1; then exec bun "$@"; fi
exec node "$@"
