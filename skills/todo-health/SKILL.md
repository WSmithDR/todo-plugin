---
name: todo-health
description: "Verifies that todo-plugin is correctly integrated in the current project. Run this after installing or updating the plugin to confirm skills, hooks, entrypoints and .todo/ structure are working."
---

# Todo Plugin — Health Check

Verifica que **todo lo que el plugin declara exista y arranque**, en cada CLI
soportado. No alcanza con que los manifiestos estén bien escritos: un manifiesto
puede declarar una ruta que no existe, o un hook que apunta a un archivo borrado,
y nada se entera hasta que un usuario lo sufre.

## Process

### 1. Correr el check

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-health.sh"
```

Un solo comando. Reporta:

| Verificación | Qué detecta |
|---|---|
| `runtime` | Que haya bun o node ≥22.18 — sin eso ningún `.ts` puede ejecutarse |
| `versiones` | Drift entre `cli-config.yaml` y los campos de versión de cada manifiesto |
| rutas declaradas | Un `skills:` o un `plugin:` que apunta a algo que no está en disco |
| hooks | Un hook registrado cuyo comando referencia un archivo inexistente, o un `hooks.json` vacío (adapter escrito y nunca cableado) |
| skills / agents | Frontmatter incompleto: sin `description` no se descubren; un agente sin cuerpo llega a OpenCode con el prompt vacío |
| entrypoints | Que cada uno arranque de verdad, ejecutándolo sin efectos |
| opencode entrypoint | Que resuelva sus imports y exponga los 5 hooks |

Después imprime el estado del `.todo/` de este proyecto y su `config.json`.

### 2. Interpretar la salida

- `✓` en todo → el plugin está sano; reportalo y terminá.
- `⚠` → no rompe nada, pero conviene mencionarlo.
- `✗` → hay algo declarado que no existe o no arranca. El detalle dice qué.

Fallas frecuentes y su arreglo:

| Falla | Arreglo |
|---|---|
| `versiones: cli-config.yaml dice X, pero …` | `python3 bin/dev/generate-cli-configs.py` |
| `config: sin configurar` | Invocar la skill `todo-config` |
| `runtime: no hay bun ni node` | Instalar alguno de los dos |
| `apunta a …, que no existe` | El archivo se borró o se renombró sin actualizar el manifiesto |

### 3. Reportar

Pasá la salida al usuario tal cual —ya viene formateada— y agregá una línea de
cierre con el veredicto. Si hubo `✗`, decí explícitamente qué comando lo arregla.

## Modo CI

`bin/todo-health.sh --strict` omite el estado del proyecto y sale con 1 si algo
falla. Es lo que corre en el workflow de tests.
