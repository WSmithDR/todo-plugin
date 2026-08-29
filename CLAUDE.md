# todo-plugin

A Claude Code plugin for task lifecycle management. Maintains `.todo/TODO.md`, `.todo/DOING.md`, `.todo/DONE.md`, and `.todo/DISCARDED.md` using the Eisenhower Q1–Q4 matrix.

## Install

**1. Registrar el marketplace (una sola vez, global):**
```bash
claude plugin marketplace add WSmithDR/todo-plugin
```

**2. Instalar en el proyecto:**
```bash
claude plugin install todo-plugin@todo-plugin --scope project
```

**Global (todos los proyectos):**
```bash
claude plugin install todo-plugin@todo-plugin
```

## Update

**Scope project:**
```bash
claude plugin update todo-plugin@todo-plugin --scope project
```

**Scope user (global):**
```bash
claude plugin update todo-plugin@todo-plugin
```

Para verificar que el update tomó efecto, ejecutar `/todo-health` — la versión mostrada debe coincidir con la última publicada. El plugin sigue semver (`MAJOR.MINOR.PATCH`) y la versión se incrementa automáticamente en cada commit según el prefijo:

| Prefijo | Bump |
|---|---|
| `feat:` | minor |
| `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `test:`, `ci:` | patch |
| `feat!:` o `BREAKING CHANGE` en el cuerpo | major |

## Código (`src/`)

En migración a TypeScript. **No hay build**: node (≥22.18) y bun ejecutan los
`.ts` directo borrando los tipos. Por eso los imports llevan extensión `.ts` y
está prohibida la sintaxis no borrable (`enum`, `namespace`, decorators) —
`erasableSyntaxOnly` en el tsconfig lo hace un error de compilación.

```bash
node --test 'src/**/*.test.ts'   # tests
bun test src/                    # los mismos, bajo el otro runtime
npx tsc --noEmit                 # único typecheck del proyecto
bash bin/todo-health.sh          # conformance: lo declarado existe y arranca
```

**Corré la suite bajo los dos runtimes.** En producción los `.ts` los ejecuta bun
(OpenCode) o node (Claude Code), y no siempre parsean igual: un
`const declare = …` que node y `tsc` aceptan sin chistar rompe el parser de bun.
Los cuatro comandos corren en CI.

| Path | Qué |
|---|---|
| `src/core/protocol.ts` | `ToolEvent`, `Decision` (`allow`/`deny`/`advise`), `mergeDecisions`. Lo único que importan los adapters |
| `src/core/rules/` | Las reglas, puras: reciben el estado de I/O como parámetro y devuelven una `Decision` |
| `src/core/paths.ts` | **Único** dueño de la resolución del root del plugin. No lo recalcules en otro archivo |
| `src/core/window.ts` | Ventana de escritura del guard |
| `src/core/store.ts` | Registro central de proyectos sin repo |
| `src/core/discovery.ts` | Escanea `skills/` y `agents/` leyendo frontmatter |
| `src/adapters/claude-code/` | `normalize` (payload → `ToolEvent`), `decide` (→ `Decision`), `emit` (→ exit code) |
| `src/cli/` | Lo que invocan las skills y git: `todo-guard`, `todo-store`, `pre-commit` |

| `src/core/pipeline.ts` | Qué reglas corren en cada fase y con qué contexto. Los adapters lo llaman; ninguno lo reimplementa |
| `src/core/instructions.ts` | Índice de skills + reglas duras para el system prompt. Cada adapter aporta su `Dialect` (cómo se carga una skill, cómo se llama su tool de preguntas) |

`core/` no sabe qué CLI está corriendo: esa traducción es de `adapters/`. **Un
adapter solo debería tener normalize + emit + su dialecto**; si te encontrás
escribiendo la misma lógica en los dos, va a `core/`. Pasó dos veces: el cableado
de las reglas (idéntico, con los comentarios copiados) y las instrucciones del
system prompt, que vivían dentro del adapter de OpenCode por ser el único con
canal.
Ver `docs/superpowers/specs/2026-08-03-migracion-typescript-multi-cli-design.md`.

**En Claude Code ya corre todo sobre TS.** OpenCode sigue con paridad parcial
hasta la fase 3.

Los archivos de `bin/` que quedan son shims de 8 líneas sin lógica: resuelven el
runtime y delegan. `bin/todo-guard.sh` y `bin/todo-store.sh` conservan su nombre
a propósito — las 12 SKILL.md los invocan por ahí, y mantener esa interfaz
estable es lo que permitió migrar sin tocar ni una skill.

## Manifiestos de los CLIs

`cli-config.yaml` es la fuente única. **No edites los manifiestos a mano** — se
regeneran desde ahí:

```bash
python3 bin/dev/generate-cli-configs.py           # regenera
python3 bin/dev/generate-cli-configs.py --check   # drift; corre en CI
python3 bin/dev/generate-cli-configs.py --list    # paths que genera
```

Genera `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` y
`opencode.json`. La versión también vive ahí y tiene un solo escritor: el hook
`post-commit` la bumpea en el YAML y regenera. Antes escribía directo en
`plugin.json` y `marketplace.json` quedó 21 minors atrás (`1.0.0` vs `1.21.11`).

Para agregar un CLI: escribí una `gen_*()` en el generador y sumala a `TARGETS`.
Solo si verificaste que el plugin funciona ahí — un manifiesto que declara
capacidades inexistentes es peor que no tenerlo.

## File structure

All task files live under `.todo/` in the project root — never at the root level.

**Proyectos sin repositorio git** (p.ej. un sitio WordPress operado vía MCP) no
tienen un `.todo/` local. En su lugar, el plugin mantiene un registro central:
`~/.local/share/todo/` es un único repo git con un subdirectorio `<id>/.todo/` por
proyecto. Al ejecutar un skill fuera de un repo, se elige el proyecto desde un menú
(o se crea uno nuevo). Identidad = nombre + id; no se crean archivos en el cwd.

**Centralización optativa de los repos** (`central_repos` en
`~/.local/share/todo/settings.json`): con la preferencia activa, `mode()` reporta
`nonrepo` también dentro de repos git — todas las habilidades reusan el flujo de
menú de proyectos y las tareas viven en el store, no junto al código. Cada repo
queda amarrado a UN proyecto vía el campo `"origin"` de su `config.json`
(`projectForRepo`). La mudanza es `todo-store.sh adopt [<ruta>]`: mueve el
`.todo/` local al store, registra el origen y borra el local — idempotente por
repo, y **cierra el commit de ese borrado** acotado con pathspec `-- .todo` si el
directorio estaba trackeado: sin eso quedaban cuatro deletes sueltos en el working
tree, indistinguibles de una pérdida de datos y listos para colarse en el próximo
`git add -A` ajeno. Mientras exista `.todo/` local, gana el local: la migración es
reversible volviendo a crear el directorio. El punto de registro entre
máquinas es `last_commit` en el config del proyecto: avanza solo cuando una
skill registra trabajo real (DONE/DISCARDED) desde ese repo, y el post-commit
centralizado lo usa para la lista retroactiva — un commit forzado con
--no-verify queda reclamado hasta que alguien cierre la tarea.

**SessionStart también los cubre** (`storeSetup` en `session-setup.ts`): sin la
preferencia, solo **fuera de un repo**; con `central_repos` activa, también dentro
de los repos amarrados por `origin` — ese repo ya es el proyecto. En ambos casos
recorre los proyectos del store, rota sus archivos por año en silencio —commiteando, porque el store se versiona solo— y junta en UN aviso los que
estén cargados o vencidos, una vez por proyecto y por día. Sin esto no los alcanzaba
nada: el gate era `if (!existsSync(cwd/.todo)) return ALLOW`, y son justo los
proyectos que menos se abren, o sea donde más se acumula. Dentro de un repo sin
`.todo/` no dice nada — un proyecto de código ajeno no es lugar para recordar las
tareas de un sitio. Git hooks tampoco: ahí el trabajo pasa afuera, no en commits.

**Y ancla dónde viven las tareas** (`anclarStore`): en un repo ya adoptado el
arranque emite la ruta absoluta de su `.todo/` en el store más dos conteos. El repo
no tiene `.todo/` —es lo correcto—, y sin esa línea cada sesión repetía buscar → no
encontrar → concluir que se perdió; una terminó restaurando un snapshot viejo desde
la historia de git y reportando una pérdida de datos que no existía.

**Las tareas y el código pueden estar en lugares distintos**, y lo que los cruza
tiene que saberlo: `staleScope` (`core/store.ts`) devuelve el par
`{tasksDir, codeDir}` resolviendo el repo real por `origin_path`. `todo-stale`
corría su `git log` en el cwd y en un proyecto centralizado ese es el store, cuyo
git solo se mueve cuando una skill escribe una tarea: reportaba cero señales
siempre. Cualquier consumidor nuevo que cruce tareas contra historia de código sale
de ahí, no de `process.cwd()`.

| File | Purpose |
|---|---|
| `.todo/TODO.md` | Open items, sorted by Eisenhower quadrant |
| `.todo/DOING.md` | Items currently in progress |
| `.todo/DONE.md` | Completed items — **año en curso** |
| `.todo/DISCARDED.md` | Discarded items — **año en curso** |
| `.todo/DONE-<año>.md` · `.todo/DISCARDED-<año>.md` | Lo cerrado en años anteriores |

**Rotación por año.** En `SessionStart`, `rotateArchives` (`src/core/archive.ts`) manda
lo cerrado en años anteriores a `<NOMBRE>-<año>.md`, al lado. El año de un item es el
de su **última** fecha —la del cierre—, no la de creación: rotar por creación mandaría
al archivo viejo algo que se cerró ayer. Un item sin fecha se queda donde está.
Idempotente. Los consumidores de DONE.md (bitacora, informe mensual) siguen leyendo el
año en curso sin cambiar nada; para el histórico están los archivos hermanos.

## Skills

**Toda pregunta al usuario va por el tool de preguntas del CLI**, nunca en prosa:
`AskUserQuestion` en Claude Code, `question` en OpenCode. Las SKILL.md lo nombran
`AskUserQuestion` porque son un archivo solo para los dos CLIs; el adapter de
OpenCode aclara en el system prompt que se lee como "el equivalente de este CLI".
Si un CLI futuro no tiene ninguno, la alternativa es opciones enumeradas y esperar
la respuesta — nunca seguir de largo. Una pregunta enterrada en un párrafo se
contesta con "dale" y ahí nadie eligió nada: es la forma más barata de convertir
una decisión del usuario en una decisión del modelo.

Cada skill tiene que tener **quién la despierta**. Una skill que solo se invoca si
el usuario se acuerda del nombre, no se invoca: la columna de la derecha es tan
parte del diseño como la de la izquierda.

| Skill | When to use | Quién la despierta |
|---|---|---|
| `todo-add` | Add one or more items to TODO.md | `error-triage` (comando fallido) |
| `todo-triage` | Classify and prioritize existing items by quadrant | `stale-todo` (SessionStart: ≥12 items o >30 días sin revisar) |
| `todo-doing` | Move an item from TODO to DOING | `branch-doing` (rama nueva) · `editing-item` (tocás un archivo que una tarea menciona) |
| `todo-done` | Mark an item complete and move to DONE | `pre-commit` · `post-commit` · `session-close` |
| `todo-item` | Alta completa de un item en un paso (add → solutions → recommend → clarify) | `todo-add`, cuando el item nace flojo |
| `todo-clarify` | Explicar términos técnicos en TODO/DOING | `todo-triage`, que ya leyó los dos archivos |
| `todo-solutions` | Attach concrete solution options to a task | `todo-doing`, al empezar un item sin opciones |
| `todo-recommend` | Elegir cuál de las opciones implementar | `todo-solutions`, y `todo-doing` con él |
| `todo-config` | Configuración por proyecto | `session-setup` (`.todo/` sin config.json) |
| `todo-health` | Diagnóstico de la instalación | El usuario, cuando algo no anda. **No necesita disparador: es el disparador** |
| `todo-audit` | Full codebase audit — generates TODO.md from scratch | El usuario / el agente `todo-audit` |

## Agents

- **`todo-agent`** — orchestrates multi-skill todo operations in a single session
- **`todo-audit`** — isolated subagent for full codebase analysis; delegates to plugin skills for enriched findings

## Hooks

### Claude Code hooks (`hooks/hooks.json`)

Los tres eventos entran por el mismo entrypoint: `bin/run.sh
src/adapters/claude-code/hook.ts <modo>`.

| Hook | Trigger | Regla | Verbo |
|---|---|---|---|
| `SessionStart` | Inicio de sesión | `session-setup`: instala los git hooks, rota DONE/DISCARDED por año y detecta `.todo/` sin `config.json` | `advise` |
| `SessionStart` | Inicio de sesión | `stale-todo`: TODO.md con ≥12 items o >30 días sin revisar → `todo-triage` | `advise` |
| `PreToolUse(Edit/Write/MultiEdit/Bash)` | Escritura sobre `.todo/` | `guard`: solo pasa dentro de la ventana que abre un skill. Bypass: `TODO_GUARD=off` | `deny` |
| `PostToolUse(Bash)` | Comando fallido | `error-triage`: evalúa si merece una tarea. Fuera de un repo con proyectos en el store, también avisa: el destino se elige del menú | `advise` |
| `PostToolUse(Bash)` | `git switch` / `checkout -b` a rama de feature | `branch-doing`: recuerda mover la tarea a DOING.md | `advise` |
| `PostToolUse(Edit/Write/MultiEdit)` | Editar un archivo que una tarea abierta menciona | `editing-item`: sugiere `todo-doing`. Sin `.todo/` local, las tareas salen del proyecto del store dueño del archivo editado | `advise` |
| `SessionEnd` | Fin de sesión con commits | `session-close`: recuerda cerrar lo que quedó en DOING.md | `advise` |
| `SessionEnd` | Fin de sesión en un proyecto sin repo | `storeSessionClose`: lo mismo, pero para los proyectos del store que **esta sesión tocó** | `advise` |

**En los proyectos sin repo, "trabajaste acá" no lo dice git.** No hay commits
tuyos, así que la señal es que una skill le escribió el `.todo/`: el guard la
anota (`rememberTouched`) cuando deja pasar la escritura, y el cierre habla solo
de esos. Sin ese marcador el aviso tendría que nombrar los seis proyectos,
incluidos los que no abriste, que es la forma más rápida de volverlo invisible.
La lista se limpia al arrancar cada sesión y el aviso la consume: sale una vez.

Los tres `PostToolUse` corren en **un solo proceso** que mergea sus decisiones.

**Cobertura del ciclo de vida.** `branch-doing` solo dispara al cambiar de rama, así
que con varias tareas en la misma rama únicamente la primera avisaba;
`editing-item` cubre eso mirando qué archivo estás tocando. `session-close` cubre
el otro extremo: después del último commit no había ninguna señal.

Los dos avisan **una sola vez** — `editing-item` por tarea y por proyecto,
`session-close` solo si HEAD se movió. El estado vive en
`src/core/session-state.ts`, sobre el cache: perderlo cuesta un aviso repetido,
nada más. Un aviso que se repite es ruido que el modelo aprende a saltear.

### OpenCode (`.opencode/plugins/todo-plugin.ts` → `src/adapters/opencode/`)

| Hook | Acción | Equivale a |
|---|---|---|
| `shell.env` | Inyecta `TODO_PLUGIN_ROOT` y `CLAUDE_PLUGIN_ROOT` | — (OpenCode no las setea) |
| `config` | Registra `skills/`, un `/comando` por skill y traduce `agents/*.md` | — |
| `tool.execute.before` | Guard. `deny` → `throw` (cancela la tool call) | `PreToolUse` |
| `tool.execute.after` | error-triage + branch-doing + editing-item. `advise` → anexa a `output.output` | `PostToolUse` |
| `experimental.chat.system.transform` | Índice de skills + aviso de setup | `SessionStart` |

`session-close` es la misma función para los dos (`decideSessionClose` en
`core/pipeline.ts`); lo único que cambia es el flag `perRequest`, que activa el
gate del reflog. No es cosmético: Claude Code la llama una vez, OpenCode en cada
request.

**`session-close` va por `system.transform`, no por un hook de fin de sesión.**
OpenCode no tiene uno: de los ~31 eventos que declara su SDK, el más cercano es
`session.idle`, que es fin de **turno** — el análogo de `Stop` de Claude Code, no
de `SessionEnd`. Y el hook `event` devuelve `void`: no tiene canal de salida, así
que un aviso emitido ahí no llegaría al modelo.

`system.transform` corre por request y sí tiene canal. La condición de la regla
—que HEAD se haya movido— hace que el aviso salga **una vez por commit**, no una
por request. Cuesta un `git rev-parse` por request.

El equivalente de `SessionStart` no es un hook: los efectos corren al construir el
plugin (el factory recibe `directory`) y el aviso se cuelga del system prompt.
Usar el hook `event` obligaría a adivinar el nombre del evento de sesión.

**No hay lógica duplicada entre CLIs:** los dos adapters importan el mismo `core/`.

**Verificado en vivo contra opencode 1.17.18** (2026-08-12), en un proyecto ajeno
al repo del plugin: carga fuera de su repo, instala y **encadena** los git hooks,
inyecta skills/comandos/agentes, el guard deniega la edición directa y deja pasar
la que abre una skill, y por `system.transform` y `tool.execute.after` llegan al
modelo `stale-todo`, `branch-doing` y `error-triage`. El fallo de un comando viene
en `metadata.exit` (ver `normalize.ts`).

### Cómo referenciar el root del plugin

Los scripts que invocan las skills se resuelven así, y en ese orden:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode
```

`CLAUDE_PLUGIN_ROOT` la setea Claude Code; OpenCode no la conoce (su binario no la
menciona), así que la provee el hook `shell.env`. `TODO_PLUGIN_ROOT` va primero
porque OpenCode le pasa **el mismo objeto `env` a todos los plugins**: un nombre
global para un valor por-plugin se pisa entre plugins y rompe las skills del
perdedor sin ningún error visible.

Nunca resuelvas el root con `git rev-parse --show-toplevel` — devuelve el repo del
usuario, no el del plugin.

### Git hooks (`bin/hooks/`)

Dos, y se instalan solos en `SessionStart`:

| Hook | Qué hace |
|---|---|
| `pre-commit` | La revisión de tareas de arriba. Bloquea (git no tiene `advise`: todo exit ≠ 0 aborta) |
| `post-commit` | Red del `--no-verify` **de entrada**: avisa si el commit nunca pasó por la revisión, con la lista retroactiva de commits sin registro desde el último toque a DONE.md |

**Encadenado, no excluyente.** Si el slot ya está ocupado (husky, lefthook, el hook
de desarrollo de este repo), el que había se mueve a `<hook>.local` y el shim del
plugin lo invoca: `pre-commit` corre el `.local` primero (si sus tests fallan, el
commit muere ahí); `post-commit` corre el nuestro primero, porque un `.local` que
amenda —el autobump de versión— deja el commit como `commit (amend)` en el reflog y
la regla ignora los amends. Antes acá se avisaba "encadenalo a mano" y nadie lo
hacía: en este mismo repo la revisión estuvo inactiva meses. La migración es
retroactiva — corre en la próxima sesión de cualquier proyecto con el slot tomado.

**El registro acredita la tanda, no el commit** (`registrationCredits` en
`core/rules/pre-commit.ts`). La comparación de DONE.md contra HEAD se consume sola
—apenas entra el commit, HEAD queda más nuevo—, lo cual está bien para que un
registro viejo no habilite commits para siempre, pero asume 1 registro = 1 commit.
La convención del propio proyecto (una unidad de trabajo por commit) produce N
commits por registro: el camino disciplinado era el que el gate castigaba, y el
`--no-verify` resultante saltea toda la cadena de hooks. Ahora el registro sigue
valiendo 30 minutos.

**La marca `<git-dir>/todo-precommit-ok`** la escribe el pre-commit en cada corrida
y la consume el post-commit. Significa "la revisión se vio", no "salió allow":
como el `advise` aborta el commit, el `--no-verify` que viene después es el camino
sancionado. Lo que su ausencia delata es el commit forzado de entrada.

`todo-health` reporta el estado de los dos hooks — sin eso nadie se entera de que
el slot lo ocupa otro.

#### Detalle de la revisión (`bin/hooks/pre-commit.sh`)

Editor-agnóstico — corre en cualquier CLI o editor. Se instala automáticamente via `SessionStart` en la primera sesión del proyecto. Bloquea `git commit` si hay tareas en DOING.md que podrían estar resueltas por los cambios en staging.

**Nombra las tareas rezagadas.** De TODO.md no muestra un contador sino los items
abiertos que **mencionan algún archivo del staging** (`itemsMentioning` en
`core/todo-files.ts`, el mismo matcher que usa `editing-item`). Nadie compara 40
items contra un diff; la tarea abierta cuyo arreglo ya está en el commit es
justamente la que se rezaga para siempre.

Corre **aunque no haya tareas abiertas**: si el commit resolvió algo que nunca fue
tarea, la salida no es `--no-verify` sino crear la tarea y escribirla directo en
DONE.md (edge case *Trabajo no contemplado* en `todo-done`). El `--no-verify` queda
para commits que no resuelven nada — WIP, formato, docs. Un arreglo que se saltea el
registro desaparece de DONE.md, que es lo que consumen las otras herramientas.

### Guard de edición directa (`bin/todo-guard.sh`)

Para mantener la consistencia del formato, toda mutación de `.todo/` debe pasar
por un skill. Un hook `PreToolUse` bloquea ediciones directas (Edit/Write/Bash)
de `.todo/` salvo dentro de la ventana de 5 min que cada skill abre al ejecutarse.
Para editar a mano puntualmente, exportá `TODO_GUARD=off` (o editá el archivo en
tu editor, fuera de Claude).

## Task format

```markdown
- [ ] **[Title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ concrete fix
  - _Opción B:_ alternative
  - **Recomendación: A** — one-line justification
```

## Entry point

`todo-agent` is the main orchestrator. For full audits, it delegates to the `todo-audit` subagent which runs in isolation to avoid flooding the main context.

## Catálogo de features compartido

El tooling de infraestructura de este plugin (git hooks de desarrollo, versionado
automático, hooks de Claude Code, config por proyecto, health check, convenciones de
docs) proviene del catálogo [`cli-plugin-template`](https://github.com/WSmithDR/cli-plugin-template).

- **Para integrar una mejora del catálogo acá**: leé su `CATALOG.md`, abrí el README
  del feature y adaptá los archivos.
- **Si una mejora nacida en este plugin sirve para cualquier plugin**: promovéla al
  catálogo siguiendo su `CONTRIBUTING.md`, en vez de dejarla solo acá.

Features ya derivados de este plugin: `git-hooks`, `versioning`, `docs-conventions`,
`claude-code-hooks`, `project-config`, `health-check`.
