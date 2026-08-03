# Migración a TypeScript con arquitectura multi-CLI

**Fecha:** 2026-08-03
**Estado:** Fase 0 implementada (v1.21.9); fases 1–4 pendientes

## Problema

El plugin anda bien en Claude Code y mal en OpenCode. La causa no es una sola:
son cinco fallas, y una de ellas es arquitectónica.

| # | Falla | Efecto en OpenCode |
|---|---|---|
| **A** | Las skills resuelven el root del plugin vía `${CLAUDE_PLUGIN_ROOT}`, que OpenCode no setea | Las 12 skills y los 2 agentes se auto-bloquean |
| **B** | `SessionStart` no tiene puente | El git pre-commit nunca se instala; `config.json` faltante nunca se detecta |
| **C** | Los dos `PostToolUse` no tienen puente | `error-checker` y `branch-doing` nunca corren |
| **D** | El protocolo de hooks de Claude Code está incrustado en la lógica de negocio | Los hooks consultivos no se pueden puentear sin romper comandos |
| **E** | `agents/*.md` está en formato Claude-only | `todo-agent` y `todo-audit` no existen en OpenCode |

### Detalle de (A) — la falla dominante

Cada SKILL.md arranca con:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

`grep -c CLAUDE_PLUGIN_ROOT` sobre el binario de OpenCode devuelve **0**: la
variable no existe ahí. La expansión daba `/bin/todo-guard.sh`, el comando
fallaba, la ventana de escritura nunca se abría, y el guard —que sí estaba
puenteado— terminaba bloqueando las skills del propio plugin. La resolución de
proyecto (`todo-store.sh mode|list|create|path`, 39 invocaciones) fallaba igual.

O sea: en OpenCode el plugin se bloqueaba a sí mismo.

### Detalle de (D) — por qué esto justifica la migración

Los scripts de `bin/hooks/` hablan el dialecto de Claude Code: `exit 2` + stderr.
Ese código significa **dos cosas distintas según la fase**:

- en `PreToolUse` → bloquear la operación y mostrarle el texto al modelo;
- en `PostToolUse` → la operación ya corrió, no hay nada que bloquear: el texto
  es un aviso.

El bridge actual colapsa las dos en `exit != 0 → throw`, y en OpenCode `throw`
cancela la tool call. Puentear `error-checker` tal cual convertiría "quizás
convenga anotar esto en TODO.md" en "tu comando falló". Por eso (C) no se puede
arreglar cableando: primero hay que separar la decisión de su expresión.

## Diseño

### El contrato

Tres verbos. Todo lo demás cuelga de acá:

```ts
type Decision =
  | { action: "allow" }
  | { action: "deny";   message: string }   // abortar la operación
  | { action: "advise"; message: string }   // NO abortar; decirle esto al modelo
```

Cada CLI lo expresa a su manera, y ese mapeo es lo único específico de cada
adapter:

| | `deny` | `advise` |
|---|---|---|
| **Claude Code** | `exit 2` + stderr (fase `before`) | `exit 2` + stderr (fase `after`) |
| **OpenCode** | `throw new Error(msg)` | `output.output += msg` |

El core nunca sabe cuál de los dos está corriendo.

El mapeo de `advise` en OpenCode está validado en producción: es lo que hace
`ankify/.opencode/hooks/command-logger/after.ts`.

### El evento canónico

```ts
type ToolEvent = {
  phase: "before" | "after"
  kind: "edit" | "write" | "multiedit" | "bash" | "other"
  paths: string[]      // archivos que la operación toca
  contents: string[]   // texto a escribir (content, new_string, edits[].new_string)
  command?: string     // solo bash
  cwd: string
  result?: { ok: boolean; text: string }   // solo fase "after"
}
```

Normalizar a este tipo absorbe las diferencias de nombres de tools
(`Edit`/`Write`/`MultiEdit`/`Bash` vs `edit`/`write`/`bash`/`patch`) y de forma
del payload.

### Layout

```
src/
  core/                       ← cero conocimiento de CLIs
    protocol.ts               ToolEvent · Decision · mergeDecisions
    rules/guard.ts            (event, {windowOpen}) => Decision      ← pura
    rules/error-triage.ts     (event) => Decision                    ← pura
    rules/branch-doing.ts     (event, {branch}) => Decision          ← pura
    rules/session-setup.ts    (env) => Decision + efectos
    window.ts                 ventana de escritura del guard (open / isOpen)
    store.ts                  registro central ~/.local/share/todo
    discovery.ts              escanea skills/ y agents/ → frontmatter
    paths.ts                  self-location del plugin root

  adapters/
    claude-code/{normalize,emit,hook}.ts
    opencode/{normalize,emit,config,plugin}.ts

  cli/{todo-store,todo-guard}.ts   lo que invocan las SKILL.md
```

`mergeDecisions`: el primer `deny` gana; si no hay ninguno, los `advise` se
concatenan; si no hay ninguno, `allow`.

**La frontera que hace esto reutilizable:** `adapters/` importa de
`core/protocol.ts` y de nada más. No conoce `.todo/`, ni Eisenhower, ni el guard.
Un plugin nuevo trae sus propias `rules/` y reusa los adapters tal cual.

Las reglas reciben su estado de I/O como parámetro (`windowOpen`, `branch`) en
vez de leerlo adentro. Es lo que permite testearlas sin tocar disco ni spawnear
procesos: hoy los 229 renglones de `test-hooks.sh` son todos integración.

### Runtime: sin build, sin artefacto

Los `.ts` se ejecutan directo. OpenCode los importa nativamente (corre sobre
Bun). Claude Code solo ejecuta un comando de shell, así que va por un shim:

```bash
#!/usr/bin/env bash
# ponytail: bun primero (lo trae OpenCode); node >=22.18 hace type-stripping
# nativo. todo-health avisa si no hay ninguno.
if command -v bun >/dev/null 2>&1; then exec bun "$@"; fi
exec node "$@"
```

**Restricción que impone:** nada de `enum`, `namespace` ni decorators — sintaxis
no borrable por type-stripping. Para este código no es una restricción real.

Se descartó commitear un `dist/` compilado: exigía tres guardias para mantenerlo
fresco (build en el pre-commit de dev, check de drift en CI, y comparación de
mtime en `todo-health`), porque el `post-commit` del autobump usa `--no-verify`.
Tres mecanismos para custodiar un artefacto que no hace falta tener.

Precedente: `ankify/bin/lib/command-logger/cli.ts` corre con `#!/usr/bin/env bun`
y acepta los payloads de OpenCode y de Claude Code en un solo entrypoint.

### Cableado

**Claude Code** — un entrypoint, tres modos. Los dos `PostToolUse` se colapsan en
un proceso que corre ambas reglas y mergea las decisiones:

```
SessionStart   → bin/run.sh src/adapters/claude-code/hook.ts session-start
PreToolUse     → ... hook.ts pre-tool-use     (Edit|Write|MultiEdit|Bash)
PostToolUse    → ... hook.ts post-tool-use    (Bash)
```

**OpenCode** — paridad completa, `.ts` importado directo:

```ts
export default (async ({ directory }) => ({
  "shell.env":           injectPluginRoot,   // (A)
  config:                injectConfig,       // skills + /comandos + agents → (E)
  "tool.execute.before": guardHook,          // deny
  "tool.execute.after":  adviseHook,         // error-triage + branch-doing → (C)(D)
  event:                 sessionHook,        // session.created → setup      → (B)
  "experimental.chat.system.transform": instructions,
})) satisfies Plugin
```

`injectConfig` sigue el patrón de `ankify/.opencode/hooks/config-inject/`:
registra `skills/` en `config.skills.paths`, genera un `/comando` por skill, y
traduce `agents/*.md` al formato de OpenCode (cuerpo → `prompt`, más `mode:
"subagent"`). Los archivos fuente siguen siendo únicos; no hay copias que se
desincronicen.

### Qué muere y qué sobrevive en bash

**Se borra:** `bin/todo-guard.sh`, `bin/todo-store.sh`, `bin/hooks/*.sh`,
`.opencode/plugins/lib/**` (todo el bridge JS, incluido el `spawn bash → spawn
python3` con timeout de 2 s).

**Queda en bash a propósito:** `bin/run.sh` (3 líneas); `bin/hooks/pre-commit.sh`
reducido a 2 líneas porque git exige un ejecutable; `bin/dev/*.sh` y
`bin/install-opencode.sh`, que son herramientas de desarrollo.

**python3** desaparece del runtime. Sigue en `bin/dev/git-hooks/post-commit` y en
`install-opencode.sh`.

### Tests

`test-guard.sh` y `test-store.sh` prueban scripts que dejan de existir, así que
migran por obligación. Pasan a `*.test.ts` con `node:test` + `node:assert` —lo
corren bun y node— colocados junto al módulo. CI cambia
`bash bin/dev/test-hooks.sh` por `node --test`.

## Fases

| Fase | Qué | Estado |
|---|---|---|
| **0** | `shell.env` + namespaceo del plugin root | ✅ v1.21.9 |
| **1** | `core/` + protocol + tests, sin cablear nada | pendiente |
| **2** | Adapter Claude Code + `hooks.json` + borrar los bash | pendiente |
| **3** | Adapter OpenCode completo → paridad (B)(C)(D)(E) | pendiente |
| **4** | Docs, `todo-health`, limpieza | pendiente |

Cada fase se puede shippear sola.

### Fase 0 — implementada

`shell.env` inyecta el root del plugin en el entorno de los comandos. Se
confirmó desde el binario de OpenCode que el hook se despacha y que su resultado
se usa como `extendEnv` del proceso:

```
trigger("shell.env", {cwd, sessionID, callID}, {env:{}})  →  Pi.make(…, {cwd, extendEnv…})
```

Ese `{env:{}}` inicial reveló algo que cambió el fix: **`output.env` arranca
vacío y es el mismo objeto para todos los plugins registrados**. `CLAUDE_PLUGIN_ROOT`
es entonces un nombre global para un valor que es por-plugin: dos plugins que lo
escriban se pisan, y las skills del perdedor fallan sin ningún error visible. Por
eso se declaran dos variables:

- `TODO_PLUGIN_ROOT` — la nuestra, siempre, sin ambigüedad.
- `CLAUDE_PLUGIN_ROOT` — compatibilidad, y solo si nadie llegó antes.

Las skills y los agentes pasaron a `"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}"`,
que resuelve igual en Claude Code, donde la primera no existe.

**Convención derivada, aplicable a cualquier plugin multi-CLI:** el root del
plugin se referencia con una variable propia del plugin y fallback a la del CLI.
Nunca se resuelve con `git rev-parse --show-toplevel`, que devuelve el repo del
usuario (ver `cli-plugin-template/ankify/feedbacks/feedback_plugin-root-sh-resuelve-repo-de-trabajo.md`).

## Riesgos y decisiones abiertas

**`advise` en fase `before` no está implementado.** Ninguna regla actual lo
necesita. Si alguna lo llegara a necesitar, el mecanismo en Claude Code es JSON
por stdout con `permissionDecision: "allow"` más `systemMessage`. Queda marcado
con un comentario `ponytail:` en el emit, sin código.

**Verificación end-to-end de la fase 0 pendiente.** El hook está cubierto por
tests unitarios (inyección, no-colisión, y que la expansión real de las SKILL.md
resuelva en ambos CLIs), y el despacho de `shell.env` está confirmado leyendo el
binario. Falta correr una skill del plugin dentro de OpenCode: el gate de
cuarentena de ankify —plugin global, con un bloqueo activo desde el 2026-07-31—
frena el tool de bash, y desactivarlo no correspondía.

**Colisión en `.git/hooks/pre-commit`.** El `SessionStart` del plugin instala ahí
el hook de revisión de tareas; `bin/dev/setup.sh` instala ahí el runner de tests
de desarrollo. Se pisan mutuamente en cada sesión. La fase 3 rediseña
`session-setup`, y ahí hay que resolver esto: componer en vez de sobrescribir, o
detectar que el destino ya está ocupado por otro hook conocido.

**Los 3 items abiertos en TODO.md son todos sobre internals de `todo-store.sh`**
(directorio huérfano si falla `git commit` en `create`, `$PWD` lógico vs físico
en `mode`, y el slug que descarta acentos). La fase 1 los reescribe en TS, así
que conviene arreglarlos ahí en vez de parchear el bash que va a morir.

## Fuera de alcance

Promover la capa de adapters al catálogo `cli-plugin-template` como feature
`multi-cli-hooks` (se diseña extraíble, no se extrae ahora); migrar los scripts
de desarrollo; un `cli-config.yaml` estilo ankify para los manifiestos
multi-CLI; soporte para Codex, Cursor o Gemini —la arquitectura los habilita, no
los implementa.
