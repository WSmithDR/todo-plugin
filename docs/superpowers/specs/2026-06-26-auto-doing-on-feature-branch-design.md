# Auto-DOING al entrar a una rama de feature

_Diseño · 2026-06-26_

## Problema

La skill `todo-doing` mueve una tarea de `.todo/TODO.md` a `.todo/DOING.md`, pero **nada
la dispara**: hay que acordarse de invocarla. En la práctica se arranca a trabajar una
feature y DOING.md queda desactualizado, perdiendo su rol de "fuente de verdad de lo en
progreso". Falta un mecanismo que lo recuerde/obligue al empezar.

## Decisiones

| Decisión | Elegido | Por qué |
|---|---|---|
| Señal de "estamos en una feature" | Crear/cambiar a una rama de feature | Señal limpia y determinista; encaja con el flujo por ramas. Editar código es demasiado ruidoso; `SessionStart` llega tarde. |
| Cómo se identifica la tarea | Delegar en Claude vía `todo-doing` | El hook ordena, no adivina. Reusa la skill (que ya pregunta si no está claro). El matching por nombre de rama es frágil. |
| Enforcement | Suave (`exit 2`, directiva) | Mismo mecanismo que `error-checker.sh`. Cubre el caso "me olvidé". El gate duro (bloquear edits) es fricción innecesaria para un olvido. |
| `todo-doing` on-demand | Se mantiene intacta | El hook es un disparador extra, no un reemplazo. |

## Diseño

**Nuevo hook:** `bin/hooks/branch-doing.sh` — `PostToolUse(Bash)`, agregado al array
`PostToolUse > Bash` de `hooks/hooks.json` (convive con `error-checker.sh`: este solo
actúa ante comandos de rama, aquel solo ante fallos).

**Lógica (stateless):**
1. Lee el JSON del tool por stdin, extrae `tool_input.command` (mismo patrón python que `error-checker.sh`).
2. Si no existe `.todo/` en el cwd → `exit 0`.
3. Si el comando no matchea `git +(checkout|switch|branch)` → `exit 0`.
4. `current=$(git rev-parse --abbrev-ref HEAD)` — la rama **resultante** (PostToolUse corre
   después del comando; no se parsea el string). Si es base (`main`/`master`/`develop`) o
   `HEAD` (detached) → `exit 0`.
5. Si es rama de feature → `exit 2` con la directiva a stderr:
   > Estás en la rama `<rama>`. Asegurate de que la(s) tarea(s) que vas a trabajar en esta
   > rama estén en `.todo/DOING.md` (una rama puede abarcar varias). Mové las que falten con
   > `todo-doing`; ignorá las que ya estén; agregá a TODO.md las que aún no existan.

**Alcance — ramas multi-tarea:** el disparador es el comando de rama, así que el hook empuja
al **arrancar** la rama (cubre el olvido más común). Si una rama abarca varias tareas que se
inician *a lo largo* de la rama, las posteriores **no** disparan el hook (no hay evento de git
ni señal automática confiable para "empecé otra tarea en la misma rama") → esas se mueven a
mano con `todo-doing` on-demand. El hook no molesta en ese caso, solo cubre menos.

**Idempotencia sin estado:** la directiva misma instruye "ignorá las que ya estén en DOING",
así que re-cambiar a la misma rama no genera trabajo duplicado. No hace falta archivo de
estado ni recordar ramas ya disparadas.

## Casos borde

- Proyecto sin `.todo/` → silencioso (`exit 0`).
- Comando bash no relacionado a ramas → `exit 0`.
- Volver a `main`/base o detached HEAD → `exit 0`.
- Rama de feature ya con su tarea en DOING → la directiva se autoignora (Claude la salta).

## Testing

Casos nuevos en `bin/dev/test-hooks.sh` (JSON simulado por stdin, verificar exit code):
- `git checkout -b feat/x` en repo con `.todo/` y rama resultante feature → `exit 2` + directiva menciona la rama.
- Estando en `main` → `exit 0`.
- Sin `.todo/` → `exit 0`.
- Comando no-git (`ls`, `npm test`) → `exit 0`.

## Fuera de alcance (YAGNI)

- Matching rama↔tarea por texto.
- Gate duro (bloquear edits hasta mover la tarea) — upgrade futuro si la directiva suave se escapa.
- Estado persistente de ramas disparadas.
