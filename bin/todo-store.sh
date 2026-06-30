#!/bin/bash
# Registro central de proyectos sin repo.
# ~/.local/share/todo/ es un único repo git; cada proyecto es <id>/.todo/.
set -euo pipefail
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/todo"

ensure_repo() {
  mkdir -p "$BASE"
  [ -d "$BASE/.git" ] || git -C "$BASE" init -q
}

cmd="${1:-}"; shift || true
case "$cmd" in
  mode)
    case "$PWD/" in
      "$BASE"/*) echo nonrepo ;;
      *) git rev-parse --is-inside-work-tree >/dev/null 2>&1 && echo repo || echo nonrepo ;;
    esac
    ;;
  list)
    [ -d "$BASE" ] || exit 0
    for c in "$BASE"/*/.todo/config.json; do
      [ -f "$c" ] || continue
      id=$(grep -o '"id": *"[^"]*"'   "$c" | cut -d'"' -f4)
      nm=$(grep -o '"name": *"[^"]*"' "$c" | cut -d'"' -f4)
      printf '%s\t%s\n' "$id" "$nm"
    done
    ;;
  create)
    name="${1:?nombre requerido}"; ensure_repo
    slug=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' \
           | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//')
    [ -n "$slug" ] || slug="proyecto"
    id="$slug"; n=2
    while [ -d "$BASE/$id" ]; do id="$slug-$n"; n=$((n+1)); done
    dir="$BASE/$id/.todo"; mkdir -p "$dir"
    today=$(date +%Y-%m-%d); by=$(git config user.name 2>/dev/null || echo "")
    printf '{\n  "name": "%s",\n  "id": "%s",\n  "created_at": "%s",\n  "created_by": "%s",\n  "gitignore_todo": false\n}\n' \
      "$name" "$id" "$today" "$by" > "$dir/config.json"
    git -C "$BASE" add "$id/.todo/config.json"
    git -C "$BASE" commit -q -m "todo: registrar proyecto $name"
    printf '%s\n' "$id"
    ;;
  path)
    dir="$BASE/${1:?id requerido}"; mkdir -p "$dir/.todo"; printf '%s\n' "$dir"
    ;;
  *) echo "uso: todo-store.sh {mode|list|create <name>|path <id>}" >&2; exit 1 ;;
esac
