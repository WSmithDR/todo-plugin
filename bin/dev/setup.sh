#!/bin/bash
# Setup del entorno de desarrollo del plugin
# Uso: bash bin/dev/setup.sh
# Ejecutar una vez después de clonar el repo.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_SRC="$REPO_ROOT/bin/dev/git-hooks/pre-commit"
HOOK_DST="$REPO_ROOT/.git/hooks/pre-commit"

echo "todo-plugin — setup de desarrollo"
echo ""

# Git hook
if [ -L "$HOOK_DST" ] && [ "$(readlink "$HOOK_DST")" = "$HOOK_SRC" ]; then
    echo "✓ pre-commit hook ya instalado"
else
    ln -sf "$HOOK_SRC" "$HOOK_DST"
    chmod +x "$HOOK_SRC"
    echo "✓ pre-commit hook instalado → .git/hooks/pre-commit"
fi

echo ""
echo "Listo. Los tests corren automáticamente antes de cada commit."
echo "Para correrlos manualmente: bash bin/dev/test-hooks.sh"
