# Migración a TypeScript con arquitectura multi-CLI

**Fecha:** 2026-08-03
**Estado:** Fases 0, 0.5 y 1 implementadas (v1.21.15); fases 2–4 pendientes

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

cli-config.yaml               fuente única de los manifiestos de todos los CLIs
bin/dev/generate-cli-configs  regenera los manifiestos; --check detecta drift
```

`core/paths.ts` es el **único** dueño de la resolución del root del plugin. No se
recalcula en ningún otro archivo: es la falla que ya apareció tres veces en este
ecosistema (ver "Se evita", punto 1).

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
corren bun y node— colocados junto al módulo.

CI pasa a correr tres cosas, y las tres son obligatorias:

```
node --test                                  # unitarios + integración
tsc --noEmit                                 # sin build, es el ÚNICO typecheck
python3 bin/dev/generate-cli-configs.py --check   # drift de manifiestos
```

La segunda y la tercera existen porque este diseño no compila nada: sin `tsc` un
error de tipos llega a producción, y sin `--check` los manifiestos se desincronizan
en silencio (le pasó a ankify, que tiene el `--check` escrito y ningún CI que lo
corra).

## Lo que se toma de ankify

`ankify` es el plugin multi-CLI más avanzado del ecosistema y ya resolvió la
mitad de este problema — la otra mitad la tiene rota, y de forma simétrica:

| | Claude Code | OpenCode |
|---|---|---|
| **todo-plugin** | 4 hooks registrados | se auto-bloqueaba (arreglado en fase 0) |
| **ankify** | `hooks/hooks.json` **vacío** | firewall completo |

Su propio CLAUDE.md lo admite: *"hoy el gate se monta solo desde
`.opencode/plugins/ankify.ts`. Bajo Claude Code el adaptador `cli.ts --append`
existe pero no hay hook registrado."* El adaptador está escrito y nunca se cableó.

Esto le da a la capa de adapters **dos consumidores reales hoy**, no uno
hipotético: todo-plugin necesita el lado OpenCode, ankify necesita el lado Claude
Code. Sigue fuera de alcance extraerla al catálogo, pero la frontera se valida
contra un segundo caso concreto en vez de contra una suposición.

### Se adopta

1. **`cli-config.yaml` + `bin/dev/generate-cli-configs.py`** — fuente única que
   genera 8 manifiestos (`.claude-plugin/plugin.json` y `marketplace.json`,
   `.codex-plugin/`, `.cursor-plugin/`, `.copilot-plugin/`,
   `gemini-extension.json`, `opencode.json`, `.mcp.json`), con modo `--check`
   que detecta drift y sale 1.

   todo-plugin lo necesita **ya**: tiene solo 2 manifiestos y están
   desincronizados — `plugin.json` en `1.21.11` y `marketplace.json` en `1.0.0`,
   porque el `post-commit` del autobump solo escribe el primero.

2. **La partición `bin/lib/` (dominio, sin CLI) vs `.opencode/` (cableado)** —
   es el mismo corte que `core/` vs `adapters/` de este spec, validado en un
   plugin de ~40 módulos. Confirma que la frontera aguanta a escala.

3. **Entrypoint de adapter con doble payload** — `bin/lib/command-logger/cli.ts`
   acepta el formato de OpenCode y el de Claude Code en una sola cabecera. Es
   el precedente del `normalize.ts` de este diseño.

4. **`config-inject`** — registra `skills/` en `config.skills.paths`, genera un
   `/comando` por skill, y traduce `agents/*.md` al formato de OpenCode (cuerpo →
   `prompt`, más `mode: "subagent"`), sin copiar archivos.

5. **`tsconfig` con `strict` + `noUnusedLocals` + `noUnusedParameters` +
   `noEmit`, y `tsc --noEmit` como comando de typecheck.** Sin paso de build, ese
   comando es la *única* verificación de tipos que existe: va a CI, no es opcional.

6. **Las instrucciones de sesión como archivo aparte** (`session-instructions.md`)
   inyectado por `system.transform`, en vez de armarse en JS. Separa el contrato
   con el agente —prosa que se edita seguido— del código que lo entrega.

7. **La convención de comentarios**: en español, explicando el *porqué* y citando
   el bug o el bypass que los motivó.

### Se evita

Los errores de ankify son todos de la misma familia — **declarado ≠ verificado**:

1. **La resolución del root se hace ad-hoc en varios lugares, y en dos de tres
   está mal.** `bin/git/plugin-root.sh` caía a `git rev-parse --show-toplevel`
   (devuelve el repo del usuario; hay un feedback registrado). `bin/dev/bump-version.py`
   línea 26 hace `Path(__file__).resolve().parent.parent`, que desde `bin/dev/`
   da `ankify/bin` y no el repo: `--check` y `--sync` fallan al arrancar. El
   docstring todavía dice *"repo root desde `bin/`"* — el archivo se movió y el
   cálculo no. **Un solo módulo `core/paths.ts` es dueño de esto.**

2. **Manifiestos que declaran rutas inexistentes.** `.codex-plugin`,
   `.cursor-plugin` y `.copilot-plugin` declaran `"agents": "./agents/"`, pero
   `agents/` no existe en ankify. `gemini-extension.json` declara
   `contextFileName: GEMINI.md`, que tampoco existe. `.mcp.json` figura como
   target del generador y no está en disco. Generar config no valida nada.

3. **`--check` existe pero no hay CI.** `ankify/.github/workflows/` no existe, así
   que el detector de drift nunca corrió y el repo acumuló 1/8 manifiestos rotos.
   Una verificación que nadie ejecuta es documentación.

4. **`discoverAgents()` escanea un directorio que no existe** y devuelve `{}` en
   silencio. Código que parece vivo.

5. **Un adapter escrito no es un adapter cableado** — `hooks/hooks.json` vacío.

### Consecuencia de diseño: conformance check

De ahí sale un componente que no estaba en la versión anterior de este spec: **no
alcanza con generar config, hay que verificar que lo declarado exista.**
`todo-health` se extiende a correr, por cada CLI soportado:

- toda ruta declarada en su manifiesto existe en disco;
- todo hook declarado apunta a un entrypoint ejecutable;
- todo entrypoint arranca (`--version` o equivalente, sin efectos);
- el runtime resuelto por `bin/run.sh` está presente;
- las versiones coinciden entre todos los manifiestos.

Y corre en CI, no solo a pedido. Es lo único que distingue "soportamos 6 CLIs" de
"declaramos 6 CLIs".

## Fases

| Fase | Qué | Estado |
|---|---|---|
| **0** | `shell.env` + namespaceo del plugin root | ✅ v1.21.9 |
| **0.5** | `cli-config.yaml` + generador + `--check` en CI | ✅ v1.21.13 |
| **1** | `core/` + protocol + tests, sin cablear nada | ✅ v1.21.15 |
| **2** | Adapter Claude Code + `hooks.json` + borrar los bash | pendiente |
| **3** | Adapter OpenCode completo → paridad (B)(C)(D)(E) | pendiente |
| **4** | Conformance check en `todo-health` + docs + limpieza | pendiente |

Cada fase se puede shippear sola.

La 0.5 se adelanta al resto porque arregla un bug vivo —`marketplace.json` quedó
en `1.0.0` mientras `plugin.json` va por `1.21.11`— y porque es independiente de
todo lo demás: no toca una línea de la lógica del plugin.

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

**~~`marketplace.json` está 21 minors atrasado.~~** Resuelto en la fase 0.5.
Queda el registro porque explica por qué la versión tiene un solo escritor: `plugin.json` va por `1.21.11` y
`marketplace.json` declara `1.0.0`, en dos campos (`metadata.version` y
`plugins[0].version`), porque el `post-commit` del autobump solo escribe el
primero. El impacto exacto sobre `claude plugin update` no está medido; el drift
es real igual. Lo arregla la fase 0.5, que pone la versión en `cli-config.yaml` y
proyecta a los dos manifiestos desde ahí.

**Los 3 items abiertos en TODO.md ya están arreglados en `src/core/store.ts`**
(directorio huérfano si falla `git commit` en `create`, `$PWD` lógico vs físico
en `mode`, y el slug que descarta acentos), con un test de regresión cada uno.
Pero siguen abiertos a propósito: lo que corre en producción es el bash, y los
fixes no llegan al usuario hasta que la fase 2 cablee el adapter. Se cierran ahí.

## Fuera de alcance

Promover la capa de adapters al catálogo `cli-plugin-template` como feature
`multi-cli-hooks` (se diseña extraíble, no se extrae ahora); migrar los scripts
de desarrollo; un `cli-config.yaml` estilo ankify para los manifiestos
multi-CLI; soporte para Codex, Cursor o Gemini —la arquitectura los habilita, no
los implementa.
