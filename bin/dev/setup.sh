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

# Desinstala hooks que este repo ya no provee, pero que un setup viejo dejó
# instalados. prepare-commit-msg bumpeaba la versión antes de que post-commit se
# hiciera cargo; con los dos puestos, cada commit bumpea DOS veces.
# Solo toca symlinks que apuntan acá — un hook propio del usuario no se borra.
remove_obsolete_hook() {
    local name="$1"
    local dst="$REPO_ROOT/.git/hooks/$name"

    [ -L "$dst" ] || return 0
    case "$(readlink "$dst")" in
        "$REPO_ROOT/bin/dev/git-hooks/"*) ;;
        *) return 0 ;;
    esac

    rm -f "$dst"
    echo "✓ $name obsoleto removido (bumpeaba la versión por duplicado)"
}

echo "todo-plugin — setup de desarrollo"
echo ""

install_hook "pre-commit"
install_hook "post-commit"

remove_obsolete_hook "prepare-commit-msg"
remove_obsolete_hook "commit-msg"

echo ""
echo "Listo."
echo "  pre-commit  : corre tests antes de cada commit"
echo "  post-commit : auto-bump version según conventional commits y amenda el commit"
echo ""
echo "Para correr tests manualmente: bash bin/dev/test-hooks.sh"
