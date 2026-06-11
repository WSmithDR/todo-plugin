#!/bin/bash
# SessionStart:
# 1. Instala el git pre-commit hook si .todo/ existe y no está instalado
# 2. Detecta .todo/ sin config.json y solicita configuración

set -euo pipefail

[ ! -d ".todo" ] && exit 0

# Instalar git hook si aplica
if [ -d ".git" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    HOOK_DST=".git/hooks/pre-commit"
    HOOK_SRC="${CLAUDE_PLUGIN_ROOT}/bin/hooks/pre-commit.sh"

    if [ ! -L "$HOOK_DST" ] || [ "$(readlink "$HOOK_DST")" != "$HOOK_SRC" ]; then
        mkdir -p .git/hooks
        ln -sf "$HOOK_SRC" "$HOOK_DST"
        chmod +x "$HOOK_SRC"
        echo "TODO-SETUP: Git pre-commit hook instalado en .git/hooks/pre-commit"
    fi
fi

# Detectar config faltante
[ -f ".todo/config.json" ] && exit 0

echo "TODO-CONFIG-MISSING: Este proyecto tiene .todo/ pero no tiene config.json.
Invocar Skill('todo-config') para configurar el plugin antes de continuar con cualquier operación de tareas." >&2
exit 2
