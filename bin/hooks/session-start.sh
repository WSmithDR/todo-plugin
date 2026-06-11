#!/bin/bash
# SessionStart: detecta .todo/ sin config.json y solicita configuración inicial

set -euo pipefail

# Solo actuar si el proyecto tiene .todo/
[ ! -d ".todo" ] && exit 0

# Si ya existe config.json, no hacer nada
[ -f ".todo/config.json" ] && exit 0

echo "TODO-CONFIG-MISSING: Este proyecto tiene .todo/ pero no tiene config.json.
Invocar Skill('todo-config') para configurar el plugin antes de continuar con cualquier operación de tareas." >&2
exit 2
