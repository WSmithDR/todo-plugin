#!/usr/bin/env bash
# Shim: la lógica está en src/cli/post-commit.ts. Acá solo se resuelve el runtime.
# Git lo ejecuta directo, así que tiene que ser un ejecutable de shell.
#
# Red de contención del `--no-verify`: git corre post-commit aunque el commit
# haya salteado el pre-commit, así que este es el único punto donde el bypass
# todavía se puede avisar.
SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/../.." && pwd)"

# El nuestro va PRIMERO, al revés que en pre-commit: un post-commit encadenado
# suele amendar (p.ej. el autobump de versión de este repo) y después del amend
# el commit ya figura como `commit (amend)`, que la regla ignora a propósito.
"$ROOT/bin/run.sh" "$ROOT/src/cli/post-commit.ts" "$@" || true

LOCAL="$(git rev-parse --git-path hooks/post-commit).local"
if [ -x "$LOCAL" ]; then exec "$LOCAL" "$@"; fi
exit 0
