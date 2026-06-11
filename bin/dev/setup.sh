#!/bin/bash
# Setup del entorno de desarrollo del plugin
# Uso: bash bin/dev/setup.sh
# Ejecutar una vez después de clonar el repo.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

install_hook() {
    local name="$1"
    local src="$REPO_ROOT/bin/dev/git-hooks/$name"
    local dst="$REPO_ROOT/.git/hooks/$name"

    chmod +x "$src"
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
        echo "✓ $name hook ya instalado"
    else
        ln -sf "$src" "$dst"
        echo "✓ $name hook instalado → .git/hooks/$name"
    fi
}

echo "todo-plugin — setup de desarrollo"
echo ""

install_hook "pre-commit"
install_hook "post-commit"

echo ""
echo "Listo."
echo "  pre-commit  : corre tests antes de cada commit"
echo "  post-commit : auto-bump version según conventional commits y amenda el commit"
echo ""
echo "Para correr tests manualmente: bash bin/dev/test-hooks.sh"
