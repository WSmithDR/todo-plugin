# Feedbacks pendientes + Store central para repos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar los 4 feedbacks pendientes del store de evolución (`done-sin-iniciado-sin-semilla-de-dias`, `nonrepo-list-not-discoverable`, `pre-commit-advisory-obliga-no-verify-siempre`) e implementar el capability-gap `store-central-tambien-para-repos` con migración retroactiva de los `.todo/` locales existentes.

**Architecture:** Los tres primeros son parches acotados (dos SKILL.md y una condición `allow` en la regla pre-commit). El cuarto extiende `src/core/store.ts` —único dueño de la resolución— con una preferencia global `central_repos` en `<base>/settings.json`: cuando está activa, `mode()` reporta `nonrepo` también dentro de repos git, las skills reusan su flujo existente de menú de proyectos, y cada repo queda mapeado a un proyecto del store vía el campo `"origin"` de su `config.json`. La migración retroactiva es un subcomando `adopt` que muda el `.todo/` local al store y deja el campo `origin` registrado.

**Tech Stack:** TypeScript sin build (node ≥22.18 / bun ejecutan los `.ts` directo), `node:test` + `assert/strict`, git hooks propios.

## Global Constraints

- Imports SIEMPRE con extensión `.ts`; prohibida sintaxis no borrable (`enum`, `namespace`, decorators).
- Correr la suite bajo LOS DOS runtimes: `node --test 'src/**/*.test.ts'` Y `bun test src/`.
- Typecheck único: `npx tsc --noEmit`.
- Commits en español, prefijos convencionales (`fix:`, `feat:`, `docs:`). El post-commit bumpea la versión automáticamente — NO editar versiones a mano.
- Los paths del usuario se resuelven SIEMPRE físicos (`realpathSync`): symlink en HOME/XDG ya rompió la clasificación una vez.
- `src/core/paths.ts` es el único dueño de paths; nada recalcula roots.
- Las SKILL.md nombran el tool de preguntas `AskUserQuestion` (el adapter lo traduce).
- El feedback aplicado se cierra con `cpt feedback apply <plugin> <slug>` desde el repo de `cli-plugin-template`.

---

### Task 1: Timestamps de creación e inicio siempre con hora (`done-sin-iniciado-sin-semilla-de-dias`)

**Files:**
- Modify: `skills/todo-add/SKILL.md`
- Modify: `skills/todo-item/SKILL.md`
- Modify: `skills/todo-done/SKILL.md`

**Interfaces:**
- Consumes: formato de metadata que ya parsea bitácora: `responsable: <Nombre> · <ISO con hora>` (p.ej. `2026-08-13T17:54-05:00`).
- Produces: `creado por: <Nombre> · <ISO con hora>` (todo-add / todo-item) y regla "siempre estampar `iniciado:`" (todo-done). Sin cambios de código ni de parsers.

- [ ] **Step 1: Patch `skills/todo-add/SKILL.md`**

En las dos ocurrencias del bloque sed (líneas ~72-78 y ~81-87), cambiar la variable de fecha por timestamp con hora y usarla en la metadata:

```bash
CREATOR=$(git config user.name); CREADO=$(date -Iminutes)
for f in .todo/TODO.md .todo/DOING.md; do
  [ -f "$f" ] && sed -i -E \
    "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $CREADO)_/ }" "$f"
done
```

Y en el ejemplo de formato del final (~línea 172):

```markdown
- [ ] **[Short title]** — [One sentence: what breaks, when it breaks, what the user experiences.] _(creado por: GitName · 2026-08-25T10:30-05:00)_
```

- [ ] **Step 2: Patch `skills/todo-item/SKILL.md`**

Línea ~58, mismo cambio de formato:

```markdown
1. **`todo-add`** — write and insert the item in the correct section of `.todo/TODO.md`, including `_(creado por: GitName · YYYY-MM-DDTHH:MM±HH:MM)_` metadata
```

- [ ] **Step 3: Patch `skills/todo-done/SKILL.md`**

En el paso 5, reemplazar el bullet que hoy dice *"Si el ítem se cierra directo desde TODO.md … no agregues nada"* por:

```markdown
- **El `| iniciado: <ISO>` va SIEMPRE** dentro del bloque `_(creado por: ...)_`. Si el ítem viene de DOING.md ya lo trae. Si se cierra directo desde TODO.md (nunca pasó por DOING), estampá `iniciado:` con el timestamp de creación del ítem — el que sigue al `·` de `creado por:`. Si ese `creado por:` es viejo y solo trae fecha (`YYYY-MM-DD` sin hora), usala tal cual como `iniciado:` — bitacora la interpreta como medianoche. Nunca cierres sin extremo inicial: sin él, el span `iniciado → resuelto` no existe y bitacora tiene que estimar a ojo.
```

Y actualizar el tercer ejemplo (~línea 162):

```markdown
- `_(creado por: SmithDR · 2026-05-20T09:00-05:00 | iniciado: 2026-05-20T09:00-05:00)_ ✓ _resuelto: según descripción del usuario — responsable: SmithDR · 2026-06-09T10:05-05:00_` _(cerrada directo de TODO: `iniciado` = timestamp de creación)_
```

- [ ] **Step 4: Verificar**

```bash
grep -c "date -Iminutes" skills/todo-add/SKILL.md        # ≥ 2
grep -c "SIEMPRE" skills/todo-done/SKILL.md              # ≥ 1
npx tsc --noEmit                                          # sin cambios, debe pasar
```

- [ ] **Step 5: Commit**

```bash
git add skills/
git commit -m "docs(skills): creado por e iniciado siempre con hora — semilla de Días para bitacora"
```

- [ ] **Step 6: Cerrar el feedback**

Desde el repo de `cli-plugin-template`:

```bash
bin/cpt feedback apply todo-plugin done-sin-iniciado-sin-semilla-de-dias
```

---

### Task 2: Alta de proyectos nonrepo visible en todo-config (`nonrepo-list-not-discoverable`)

**Files:**
- Modify: `skills/todo-config/SKILL.md`

**Interfaces:**
- Consumes: `bin/todo-store.sh {mode|list|create <name>|path <id>}` (interfaz estable de CLI, no tocar).
- Produces: flujo documentado "crear/elegir proyecto sin repo" dentro de todo-config. El Task 4e agregará más opciones a este mismo archivo — aplicar este task primero.

- [ ] **Step 1: Documentar el modelo de almacenamiento arriba del proceso**

Después del encabezado "# Todo Plugin — Config", insertar:

```markdown
## Dónde viven tus tareas

- **En un repo git**: `.todo/` local, junto al código.
- **Fuera de un repo** (sitios operados por MCP, notas personales): registro central en
  `~/.local/share/todo/<proyecto>/.todo/` — un único repo git versionado solo.
  Para crear o elegir uno de estos proyectos, este mismo skill te lo ofrece en el paso 0b.
```

- [ ] **Step 2: Reescribir el paso 0b**

Reemplazar el paso `### 0b. Solo aplica en repos` completo por:

````markdown
### 0b. Resolver modo: repo vs store central

```bash
MODE=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

**Si `MODE` es `repo`**: continuar en el paso 1 — la configuración es por proyecto y vive en `.todo/config.json` local.

**Si `MODE` es `nonrepo`**: `gitignore_todo` no aplica (el store es privado y ya nace con config válido), pero acá se dan de alta los proyectos sin repo. Preguntar con `AskUserQuestion`:

```
question: "¿Qué querés hacer con el registro central?"
header: "Store central"
options:
  - label: "Crear un proyecto nuevo"
    description: "Da de alta una lista de tareas sin repo (p.ej. una lista personal)."
  - label: "Ver los proyectos existentes"
    description: "Lista id + nombre y la ruta de cada uno."
  - label: "Nada — salir"
```

- **Crear**: pedir el nombre, luego:

```bash
ID=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" create "<nombre>")
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "$ID"
```

Confirmar al usuario con el id y la ruta impresa (ahí viven sus archivos).

- **Ver existentes**:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar el listado y terminar.
````

- [ ] **Step 3: Verificar**

```bash
grep -c "create" skills/todo-config/SKILL.md   # ≥ 3
grep -c "0b" skills/todo-config/SKILL.md       # ≥ 2
```

- [ ] **Step 4: Commit**

```bash
git add skills/todo-config/SKILL.md
git commit -m "docs(todo-config): alta y descubrimiento de proyectos sin repo en el paso 0b"
```

- [ ] **Step 5: Cerrar el feedback**

```bash
cd /home/wagner/Documentos/dev-projects/personal_tools/cli-plugin-template
bin/cpt feedback apply todo-plugin nonrepo-list-not-discoverable
```

---

### Task 3: Condición `allow` alcanzable en pre-commit (`pre-commit-advisory-obliga-no-verify-siempre`)

**Files:**
- Modify: `src/core/rules/pre-commit.ts`
- Modify: `src/cli/pre-commit.ts`
- Test: `src/core/rules/pre-commit.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `PreCommitInput` gana el campo `registeredWork: number` — cantidad de items `- [x]` o `- ~~` AGREGADOS a DONE.md/DISCARDED.md en este staging. Regla nueva: `registeredWork > 0 && markedCheckboxes === 0` → `ALLOW` (el trabajo ya quedó registrado; el commit pasa sin `--no-verify`).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `src/core/rules/pre-commit.test.ts` (respetar los helpers existentes del archivo):

```typescript
// ── trabajo ya registrado en DONE/DISCARDED → allow, no peaje ──────────────

test("staging con item cerrado en DONE.md → ALLOW", () => {
  const decision = preCommitReview({
    hasTodoDir: true,
    staged: ["src/auth.py", ".todo/DONE.md"],
    markedCheckboxes: 0,
    registeredWork: 1,
    doing: [],
    todoOpen: [],
    recentCommits: [],
  })
  assert.equal(decision.action, "allow")
})

test("checkbox huérfano en TODO sigue ganando aunque DONE traiga trabajo", () => {
  const decision = preCommitReview({
    hasTodoDir: true,
    staged: [".todo/TODO.md", ".todo/DONE.md"],
    markedCheckboxes: 2,
    registeredWork: 1,
    doing: [],
    todoOpen: [],
    recentCommits: [],
  })
  assert.equal(decision.action, "deny")
})

test("sin trabajo registrado ni checkboxes, sigue el advise de siempre", () => {
  const decision = preCommitReview({
    hasTodoDir: true,
    staged: ["src/x.ts"],
    markedCheckboxes: 0,
    registeredWork: 0,
    doing: [],
    todoOpen: [],
    recentCommits: [],
  })
  assert.equal(decision.action, "advise")
})
```

- [ ] **Step 2: Verificar que fallan**

```bash
node --test src/core/rules/pre-commit.test.ts
```

Expected: FAIL — `registeredWork` no existe en el tipo (y tsc lo marcaría).

- [ ] **Step 3: Implementar la regla**

En `src/core/rules/pre-commit.ts`:

Al tipo `PreCommitInput`, agregar después de `markedCheckboxes`:

```typescript
/** Cuántos items (`- [x]` / `- ~~`) se AGREGARON a DONE.md/DISCARDED.md en este staging. */
registeredWork: number
```

Después del guard de `markedCheckboxes` y ANTES del `if (input.staged.length === 0) return ALLOW`, insertar:

```typescript
// El peaje tenía que tener una moneda: si el staging YA registra el trabajo
// (items cerrados en DONE/DISCARDED), el commit pasa sin --no-verify. Esta es
// la condición de allow que antes no existía — un gate que nunca puede pasar
// obliga a normalizar --no-verify, que desarma toda la cadena de hooks.
if (input.registeredWork > 0) return ALLOW
```

- [ ] **Step 4: Cablear el CLI**

En `src/cli/pre-commit.ts`, agregar al objeto que se le pasa a `preCommitReview`:

```typescript
registeredWork: lines(
  git("diff", "--cached", "-U0", "--", ".todo/DONE.md", ".todo/DISCARDED.md"),
).filter((line) => line.startsWith("+- [x]") || line.startsWith("+- ~~")).length,
```

- [ ] **Step 5: Suite completa, los dos runtimes + typecheck**

```bash
node --test 'src/**/*.test.ts' && bun test src/ && npx tsc --noEmit
```

Expected: PASS en los tres.

- [ ] **Step 6: Commit**

```bash
git add src/core/rules/pre-commit.ts src/cli/pre-commit.ts src/core/rules/pre-commit.test.ts
git commit -m "fix(pre-commit): trabajo registrado en DONE/DISCARDED da allow — el gate deja de ser un peaje"
```

- [ ] **Step 7: Cerrar el feedback**

```bash
cd /home/wagner/Documentos/dev-projects/personal_tools/cli-plugin-template
bin/cpt feedback apply todo-plugin pre-commit-advisory-obliga-no-verify-sie
```

---

### Task 4a: Preferencia global `central_repos` y `mode()` que la respeta

**Files:**
- Modify: `src/core/store.ts`
- Test: `src/core/store.test.ts`

**Interfaces:**
- Produces: `centralRepos(opts?: StoreOptions): boolean` — lee `<base>/settings.json`, campo `central_repos` (default `false`). `mode()` devuelve `"nonrepo"` dentro de un repo git cuando está activa.

- [ ] **Step 1: Tests que fallan**

Agregar a `src/core/store.test.ts` (usa el helper `withStore` existente):

```typescript
// ── central_repos: los repos también salen del store ────────────────────────

function withRepo<T>(fn: (env: Record<string, string>, base: string, repo: string) => T): T {
  return withStore((env, base) => {
    const repo = mkdtempSync(join(tmpdir(), "todo-repo-"))
    execFileSync("git", ["-C", repo, "init", "-q"])
    try {
      return fn(env, base, repo)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
}

test("por defecto un repo sigue siendo repo", () => {
  withRepo((env, _base, repo) => {
    assert.equal(mode(repo, { env }), "repo")
  })
})

test("central_repos: un repo reporta nonrepo", () => {
  withRepo((env, base, repo) => {
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(mode(repo, { env }), "nonrepo")
  })
})

test("dentro del propio store siempre es nonrepo, con o sin la preferencia", () => {
  withStore((env, base) => {
    create("algo", { env })
    assert.equal(mode(join(base, "algo"), { env }), "nonrepo")
  })
})
```

- [ ] **Step 2: Verificar fallo**

```bash
node --test src/core/store.test.ts
```

Expected: FAIL en el test de `central_repos`.

- [ ] **Step 3: Implementar**

En `src/core/store.ts`, después de `storeBase`… mejor: junto al resto de funciones públicas, antes de `mode()`:

```typescript
/**
 * Preferencia global del store: ¿los proyectos CON repo también centralizan su
 * .todo acá? Vive en <base>/settings.json — fuera de los config.json por
 * proyecto, porque es una decisión del usuario, no de cada proyecto.
 */
export function centralRepos(opts: StoreOptions = {}): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(storeBase(opts.env), "settings.json"), "utf8")) as {
      central_repos?: boolean
    }
    return raw.central_repos === true
  } catch {
    return false
  }
}
```

En `mode()`, tras el `try/catch` de `git rev-parse`, cambiar el retorno exitoso:

```typescript
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: here,
      stdio: "ignore",
    })
    // Con la preferencia activa, los repos también operan sobre el store: las
    // skills ya saben resolver nonrepo con menú de proyectos, así que se reutiliza
    // ese flujo tal cual.
    return centralRepos(opts) ? "nonrepo" : "repo"
  } catch {
    return "nonrepo"
  }
```

- [ ] **Step 4: Suite + typecheck, ambos runtimes**

```bash
node --test 'src/**/*.test.ts' && bun test src/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts src/core/store.test.ts
git commit -m "feat(store): preferencia central_repos — mode reporta nonrepo dentro de repos"
```

---

### Task 4b: Mapeo repo → proyecto (`origin` + `projectForRepo` + `resolveProjectDir`)

**Files:**
- Modify: `src/core/store.ts`
- Test: `src/core/store.test.ts`

**Interfaces:**
- Consumes: `centralRepos` (Task 4a), `list`, `physical`.
- Produces:
  - `projectForRepo(repoRoot: string, opts?: StoreOptions): Project | null` — busca en `list()` el proyecto cuyo `config.json` tenga `"origin"` igual al path físico del repo; `null` si no hay, si el config está corrupto o si `centralRepos` es `false`.
  - `setOrigin(id: string, repoRoot: string, opts?): void` — escribe `"origin"` en el config del proyecto y commitea el store.
  - `resolveProjectDir(cwd: string, env?: Env): string | null` — el directorio PROYECTO (que contiene `.todo/`) donde están las tareas de este cwd: local si existe `<cwd>/.todo`, sino el del proyecto con `origin` == repoRoot de cwd. `null` si no hay ninguno. Este es el ÚNICO punto de resolución para consumidores (hooks, pipeline, editingContext).

- [ ] **Step 1: Tests que fallan**

```typescript
import { projectForRepo, resolveProjectDir, setOrigin } from "./store.ts"

test("projectForRepo exige central_repos y matchea por origin físico", () => {
  withRepo((env, base, repo) => {
    const id = create("Mi Repo", { env })
    // sin la preferencia, no resuelve aunque haya origin
    setOrigin(id, repo, { env })
    assert.equal(projectForRepo(repo, { env }), null)
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(projectForRepo(repo, { env })?.id, id)
    // y un repo distinto no resuelve a este proyecto
    const other = mkdtempSync(join(tmpdir(), "todo-other-"))
    execFileSync("git", ["-C", other, "init", "-q"])
    assert.equal(projectForRepo(other, { env }), null)
    rmSync(other, { recursive: true, force: true })
  })
})

test("resolveProjectDir: .todo local gana; si no hay, el proyecto con origin", () => {
  withRepo((env, base, repo) => {
    const id = create("Con Origen", { env })
    setOrigin(id, repo, { env })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(resolveProjectDir(repo, env), join(base, id))
    // con .todo local, gana el local (hasta que adopt lo mueva)
    mkdirSync(join(repo, ".todo"))
    assert.equal(resolveProjectDir(repo, env), repo)
  })
})

test("resolveProjectDir sin repo ni .todo → null", () => {
  withStore((env, base) => {
    const suelto = mkdtempSync(join(tmpdir(), "todo-suelto-"))
    assert.equal(resolveProjectDir(suelto, env), null)
    rmSync(suelto, { recursive: true, force: true })
  })
})
```

Nota: ajustar el import superior del test para incluir las nuevas funciones.

- [ ] **Step 2: Verificar fallo**

```bash
node --test src/core/store.test.ts
```

- [ ] **Step 3: Implementar en `src/core/store.ts`**

Helper de repoRoot (junto a `physical`):

```typescript
/** Root físico del repo que contiene `path`, o "" si no hay. */
function repoRoot(path: string): string {
  try {
    return physical(
      execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    )
  } catch {
    return ""
  }
}

function readOrigin(id: string, opts: StoreOptions): string {
  try {
    const raw = JSON.parse(readFileSync(join(storeBase(opts.env), id, ".todo", "config.json"), "utf8")) as {
      origin?: string
    }
    return typeof raw.origin === "string" ? physical(raw.origin) : ""
  } catch {
    return ""
  }
}
```

Funciones públicas (después de `create`):

```typescript
/**
 * Registra (o actualiza) qué repo alimenta este proyecto. Lo consume
 * `projectForRepo` para resolver hooks, pipeline y editing-item en repos
 * centralizados: un repo = un proyecto.
 */
export function setOrigin(id: string, repoRootPath: string, opts: StoreOptions = {}): void {
  const base = storeBase(opts.env)
  const configPath = join(base, id, ".todo", "config.json")
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>
  config.origin = physical(repoRootPath)
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  try {
    execFileSync("git", ["-C", base, "add", join(id, ".todo", "config.json")], QUIET)
    execFileSync("git", ["-C", base, "commit", "-q", "-m", `todo: ${id} ← ${basename(config.origin!)}`], QUIET)
  } catch {
    // El store puede no tener identidad git; el dato ya quedó escrito.
  }
}

/** El proyecto cuyo repo de origen es este. Exige la preferencia central_repos. */
export function projectForRepo(root: string, opts: StoreOptions = {}): Project | null {
  if (!centralRepos(opts)) return null
  const here = physical(root)
  if (here === "") return null
  return list(opts).find((project) => readOrigin(project.id, opts) === here) ?? null
}

/**
 * Dónde están las tareas de este cwd: el `.todo/` local mientras exista —así la
 * migración con `adopt` es optativa y reversible—, sino el proyecto del store
 * con `origin` en este repo. Devuelve el DIR DEL PROYECTO (el que contiene
 * `.todo/`), igual que hace `editingContext`. null si no hay ninguno.
 */
export function resolveProjectDir(cwd: string, env?: Env): string | null {
  if (existsSync(join(cwd, ".todo"))) return cwd
  const project = projectForRepo(repoRoot(cwd), { env })
  return project ? join(storeBase({ env }), project.id) : null
}
```

Importar `basename` de `node:path` en el encabezado del archivo.

- [ ] **Step 4: Suite + typecheck, ambos runtimes**

```bash
node --test 'src/**/*.test.ts' && bun test src/ && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts src/core/store.test.ts
git commit -m "feat(store): origin por proyecto + resolveProjectDir — resolución única local-vs-central"
```

---

### Task 4c: Subcomando `adopt` — migración retroactiva

**Files:**
- Modify: `src/core/store.ts`
- Modify: `src/cli/todo-store.ts`
- Test: `src/core/store.test.ts`

**Interfaces:**
- Consumes: `create`, `setOrigin`, `readOrigin`/`list` (Tasks previos).
- Produces: `adopt(repoPath: string, name: string | undefined, opts?): { id: string; dir: string }` y `todo-store adopt [<ruta>] [<nombre>]` — imprime el id. Mueve TODO/DOING/DONE/DISCARDED (+ archivos `-<año>.md`) de `<repo>/.todo/` a `<base>/<id>/.todo/`, registra `origin`, commitea el store y BORRA el `.todo/` local.

- [ ] **Step 1: Test que falla**

```typescript
import { adopt } from "./store.ts"

test("adopt muda el .todo local al store, registra origin y borra el local", () => {
  withRepo((env, base, repo) => {
    mkdirSync(join(repo, ".todo"))
    writeFileSync(join(repo, ".todo", "TODO.md"), "# TODOs\n\n- [ ] **Pendiente viejo**\n")
    writeFileSync(join(repo, ".todo", "DONE.md"), "# Completados\n")

    const { id, dir } = adopt(repo, undefined, { env })

    assert.ok(existsSync(join(dir, ".todo", "TODO.md")))
    assert.match(readFileSync(join(dir, ".todo", "TODO.md"), "utf8"), /Pendiente viejo/)
    assert.ok(existsSync(join(dir, ".todo", "DONE.md")))
    assert.ok(!existsSync(join(repo, ".todo")))
    assert.equal(list({ env }).find((p) => p.id === id)?.name, "adopt") // nombre = basename del repo
    // segunda llamada sobre el mismo repo NO crea un proyecto nuevo
    const again = adopt(repo, undefined, { env })
    assert.equal(again.id, id)
  })
})
```

(El tmpdir de `withRepo` termina en algo como `todo-repo-XXX`; el basename será `todo-repo-XXX` — el assert del nombre puede relajarse a `typeof name === "string"` según cómo quede el helper; lo importante es el id estable.)

- [ ] **Step 2: Verificar fallo**

```bash
node --test src/core/store.test.ts
```

- [ ] **Step 3: Implementar en `src/core/store.ts`**

```typescript
/**
 * Mudanza retroactiva: el `.todo/` de un repo pasa al store central y el repo
 * queda amarrado vía `origin`. Idempotente por repo — la segunda llamada
 * encuentra el proyecto por origin y no duplica nada.
 *
 * ponytail: mueve TODO/DOING/DONE/DISCARDED y sus archivos de año; cualquier
 * otro archivo suelto en .todo/ se deja atrás a propósito — si aparece algo que
 * haga falta mudar, se agrega a la lista, no un glob ciego.
 */
export function adopt(repoPath: string, name: string | undefined, opts: StoreOptions = {}): { id: string; dir: string } {
  const root = repoRoot(repoPath)
  if (root === "") throw new Error(`no es un repo git: ${repoPath}`)

  const FILES = [
    "TODO.md", "DOING.md", "DONE.md", "DISCARDED.md",
  ]

  const existing = list(opts).find((project) => readOrigin(project.id, opts) === root)
  const id = existing?.id ?? create(name ?? basename(root), opts)
  const dir = join(storeBase(opts.env), id)
  mkdirSync(join(dir, ".todo"), { recursive: true })

  const local = join(root, ".todo")
  if (existsSync(local)) {
    for (const file of readdirSync(local)) {
      if (!/^((TODO|DOING|DONE|DISCARDED)(-[0-9]{4})?\.md)$/.test(file)) continue
      cpSync(join(local, file), join(dir, ".todo", file))
    }
    rmSync(local, { recursive: true, force: true })
  }

  setOrigin(id, root, opts)
  return { id, dir }
}
```

Importar `cpSync` de `node:fs` y `basename` de `node:path`.

- [ ] **Step 4: Cablear el CLI**

En `src/cli/todo-store.ts`:

```typescript
import { adopt, create, list, mode, projectPath } from "../core/store.ts"
```

y en el switch, antes de `default`:

```typescript
    case "adopt": {
      const [target, name] = args
      const result = adopt(target ?? process.cwd(), name)
      console.log(`${result.id}\t${result.dir}`)
      break
    }
```

Actualizar la línea de uso: `uso: todo-store {mode|list|create <name>|path <id>|adopt [<ruta>] [<nombre>]}`.

- [ ] **Step 5: Suite + typecheck, ambos runtimes**

```bash
node --test 'src/**/*.test.ts' && bun test src/ && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/core/store.ts src/cli/todo-store.ts src/core/store.test.ts
git commit -m "feat(store): adopt — mudanza retroactiva del .todo local al store central"
```

---

### Task 4d: Cablear consumidores (hooks, pipeline, editing-item)

**Files:**
- Modify: `src/cli/pre-commit.ts`
- Modify: `src/cli/post-commit.ts`
- Modify: `src/core/pipeline.ts`
- Modify: `src/core/todo-files.ts`
- Test: `src/core/pipeline.test.ts` (ajustes si algún test construye contextos con `.todo` local — la resolución local gana, así que no deberían romper)

**Interfaces:**
- Consumes: `resolveProjectDir` (Task 4b).
- Produces: todos los consumidores preguntan "¿dónde están las tareas?" por `resolveProjectDir(cwd)` en vez de `existsSync(cwd/.todo)`.

- [ ] **Step 1: `src/cli/pre-commit.ts`**

Reemplazar `hasTodoDir: existsSync(join(cwd, ".todo"))` y las lecturas:

```typescript
import { resolveProjectDir } from "../core/store.ts"

const projectDir = resolveProjectDir(cwd)

const decision = preCommitReview({
  hasTodoDir: projectDir !== null,
  staged: lines(git("diff", "--cached", "--name-only")).slice(0, MAX_STAGED_SHOWN),
  markedCheckboxes: /* sin cambios — mira el diff de git, no el filesystem */,
  registeredWork: /* sin cambios — ídem */,
  doing: openItemTitles(projectDir ? readTodoFile(projectDir, "DOING.md") : ""),
  todoOpen: openItems(projectDir ? readTodoFile(projectDir, "TODO.md") : ""),
  recentCommits: lines(git("log", "--oneline", `-${RECENT_COMMITS}`)),
})
```

(importar `readTodoFile` desde `../core/todo-files.ts`; `read()` local puede eliminarse si queda sin usos.)

- [ ] **Step 2: `src/cli/post-commit.ts`**

Mismo patrón para `hasTodoDir`, y el rango retroactivo se apaga en repos centralizados (el historial de DONE.md ya no vive en el repo):

```typescript
import { resolveProjectDir } from "../core/store.ts"
import { readTodoFile } from "../core/todo-files.ts" // si postCommitReview lee archivos acá

const projectDir = resolveProjectDir(cwd)
// ponytail: en repos centralizados DONE.md ya no tiene historial en este repo,
// así que la lista retroactiva se reduce al commit corriente — la marca del
// pre-commit sigue siendo quien delata el commit forzado. Volver a la lista
// amplia si algún día el stamp vive en el store.
const centralized = projectDir !== null && projectDir !== cwd
const lastRegistered = centralized ? "" : git("log", "-1", "--format=%H", "--", ".todo/DONE.md")
const range = lastRegistered === "" ? ["-20"] : [`${lastRegistered}..HEAD`]
if (centralized) range.length = 0
```

y pasar `unregistered: git(...range.length === 0 ? [] : ["--oneline", ...])` — mantener el contrato exacto de `postCommitReview` que el archivo ya usa; solo cambia de dónde sale `lastRegistered`.

- [ ] **Step 3: `src/core/pipeline.ts` — `decideSessionClose` y `decideAfter`**

```typescript
import { projectForPath, resolveProjectDir } from "./store.ts"
```

En `decideSessionClose`, reemplazar la línea 71 y la lectura de DOING:

```typescript
  const dir = resolveProjectDir(cwd)
  if (dir === null) return trigger === "session-end" ? storeSessionClose() : ALLOW
```

```typescript
  return sessionClose({
    hasTodoDir: true,
    doing: openItemTitles(readTodoFile(dir, "DOING.md")),
    headMoved: previo !== "" && previo !== head,
  })
```

En `decideAfter`, línea 124:

```typescript
  const todoDir = resolveProjectDir(cwd)
  const todo = todoDir !== null
```

(el resto del cuerpo no cambia: `branchDoing` ya recibe `hasTodoDir: todo`, y `editingContext` se patchea en el paso siguiente).

Nota deliberada: `storeAvailable` y el gate de `storeSetup` NO se tocan — con `central_repos` activa, `mode()` ya devuelve `nonrepo` dentro de los repos, así que heredan el comportamiento gratis.

- [ ] **Step 4: `src/core/todo-files.ts` — `editingContext`**

La primera rama de resolución pasa por la función única:

```typescript
import { projectForPath, resolveProjectDir } from "./store.ts"
```

```typescript
  const dir = (() => {
    const resolved = resolveProjectDir(cwd, env)
    if (resolved !== null) return resolved
    for (const path of paths) {
      const project = projectForPath(path, { env })
      if (project) return project.dir
    }
    return null
  })()
```

- [ ] **Step 5: Suite + typecheck, ambos runtimes**

```bash
node --test 'src/**/*.test.ts' && bun test src/ && npx tsc --noEmit
```

Si algún test de pipeline construía fixtures asumiendo `.todo` local, corregir el fixture — nunca la aserción.

- [ ] **Step 6: Commit**

```bash
git add src/cli/pre-commit.ts src/cli/post-commit.ts src/core/pipeline.ts src/core/todo-files.ts
git commit -m "refactor(core): todos los consumidores resuelven tareas vía resolveProjectDir"
```

---

### Task 4e: Superficie de usuario — todo-config y CLAUDE.md

**Files:**
- Modify: `skills/todo-config/SKILL.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `centralRepos`, `adopt` (Tasks 4a/4c), el paso 0b reescrito en Task 2.
- Produces: el flujo por el cual el usuario activa `central_repos` y migra sus repos.

- [ ] **Step 1: Paso 0b de todo-config — opción de centralizar**

Dentro del bloque `MODE` del paso 0b (versión del Task 2), agregar ANTES de la pregunta del menú:

````markdown
Además, informar el estado de la centralización y ofrecerla:

```bash
cat ~/.local/share/todo/settings.json 2>/dev/null || echo "{}"
```

Si `central_repos` no es `true`, ofrecer con `AskUserQuestion`:

```
question: "¿Centralizar también los repos git? Su .todo/ viviría en el store (~/.local/share/todo) en vez de junto al código."
header: "Store central"
options:
  - label: "Sí — centralizar y migrar este repo"
    description: "Activa central_repos y muda el .todo/ local de ESTE repo al store con todo su contenido."
  - label: "Sí — centralizar de ahora en más"
    description: "Activa central_repos; los repos existentes migran cuando se ejecute todo-store.sh adopt."
  - label: "No — dejar como está"
```

- **Activar** (en ambas opciones afirmativas):

```bash
python3 - <<EOF
import json, os
base = os.path.expanduser("~/.local/share/todo")
os.makedirs(base, exist_ok=True)
p = os.path.join(base, "settings.json")
s = {}
if os.path.exists(p):
    s = json.load(open(p))
s["central_repos"] = True
json.dump(s, open(p, "w"), indent=2)
print(f"OK: {p}")
EOF
```

- **Opción "migrar este repo"** — ejecutar además:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" adopt "$(pwd)"
```

Informar el `<id>` y la ruta del store impresos. Aclarar que el `.todo/` local fue movido (borrado del repo) y que los cambios del store quedaron commiteados ahí.
````

- [ ] **Step 2: CLAUDE.md — actualizar el modelo de almacenamiento**

En la sección "**Proyectos sin repositorio git**" de CLAUDE.md, agregar después del párrafo existente:

```markdown
**Centralización optativa de los repos** (`central_repos` en
`~/.local/share/todo/settings.json`): con la preferencia activa, `mode()` reporta
`nonrepo` también dentro de repos git — todas las habilidades reusan el flujo de
menú de proyectos y las tareas viven en el store, no junto al código. Cada repo
queda amarrado a UN proyecto vía el campo `"origin"` de su `config.json`
(`projectForRepo`). La mudanza es `todo-store.sh adopt [<ruta>]`: mueve el
`.todo/` local al store, registra el origen y borra el local — idempotente por
repo. Mientras exista `.todo/` local, gana el local: la migración es reversible
volviendo a crear el directorio. Techo conocido: en repos centralizados, el
post-commit pierde la lista retroactiva de commits sin registrar (DONE.md ya no
tiene historial en el repo); la marca del pre-commit sigue delatando el commit
forzado.
```

- [ ] **Step 3: Verificar drift de manifiestos y suite**

```bash
python3 bin/dev/generate-cli-configs.py --check
node --test 'src/**/*.test.ts'
```

- [ ] **Step 4: Commit**

```bash
git add skills/todo-config/SKILL.md CLAUDE.md
git commit -m "docs: superficie de usuario para central_repos + adopt"
```

- [ ] **Step 5: Cerrar el feedback**

```bash
cd /home/wagner/Documentos/dev-projects/personal_tools/cli-plugin-template
bin/cpt feedback apply todo-plugin store-central-tambien-para-repos
```

---

### Task 5: Migración retroactiva de los repos existentes + verificación end-to-end

**Files:** ninguno en el repo — operación sobre los proyectos del usuario. Requiere el plugin actualizado en los CLIs (`claude plugin update` / reinstalar en OpenCode) para que `bin/` ejecute el código nuevo.

- [ ] **Step 1: Publicar y actualizar**

```bash
# en el repo del plugin: push (la versión ya se bumpeó sola por feat:)
git push
# luego, en cada CLI:
claude plugin update todo-plugin@todo-plugin
```

- [ ] **Step 2: Inventariar repos con `.todo/` local**

```bash
for d in ~/Documentos/dev-projects/*/*; do
  [ -d "$d/.todo" ] && echo "$d"
done
```

Presentar el listado con `AskUserQuestion` (multiple) y confirmar cuáles migrar. Excluir el store central mismo.

- [ ] **Step 3: Activar la preferencia y adoptar cada repo elegido**

```bash
# una vez:
python3 -c "..." # el snippet de settings.json del Task 4e, o vía todo-config
# por cada repo:
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" adopt "<ruta del repo>"
```

Verificar por cada uno: `ls "<repo>/.todo"` falla (fue borrado) y `todo-store.sh path <id>` muestra los archivos mudados.

- [ ] **Step 4: Smoke test end-to-end en UN repo migrado**

1. Abrir sesión → SessionStart no debe quejarse.
2. `todo-health` → reporta el store y los hooks.
3. Hacer un commit trivial → el pre-commit debe correr y, si hay trabajo registrado, dar allow.
4. Editar un archivo mencionado por una tarea → `editing-item` debe avisar.

- [ ] **Step 5: Registro**

Guardar con `engram_mem_save` (type: architecture, topic_key `todo-plugin/store-central`) el modelo nuevo: settings.json, origin, adopt, techos conocidos.

---

## Self-review

1. **Spec coverage:** los 4 feedbacks tienen tarea (T1, T2, T3, T4+T5); la migración retroactiva pedida explícitamente por el usuario es T4c + T5. El sexto feedback (`todo-done-salteado-checkboxes-a-mano`) ya está aplicado desde 2026-07-04 y `todo-config-repo-centric` se cerró al inicio de esta sesión — fuera del plan.
2. **Placeholder scan:** T4d Step 2 deja indicado "mantener el contrato exacto de postCommitReview" porque el executor leerá el archivo real — el cambio concreto (de dónde sale `lastRegistered`) está codificado.
3. **Type consistency:** `resolveProjectDir(cwd, env?)` devuelve el DIR DEL PROYECTO (contiene `.todo/`), consistente con `readTodoFile(dir, name)` y `editingContext().dir` en todos los usos. `adopt` retorna `{id, dir}` y el CLI imprime `"<id>\t<dir>"`, formato tab-separado como `path`.
