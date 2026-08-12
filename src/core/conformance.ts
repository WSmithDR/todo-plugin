import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PLUGIN_ROOT } from "./paths.ts"
import { discoverAgents, discoverSkills } from "./discovery.ts"

/**
 * Conformance check: verifica que lo que el plugin DECLARA exista y funcione.
 *
 * Existe por lo que le pasó a ankify, que tiene el tooling multi-CLI más avanzado
 * del ecosistema y aun así declara `agents/` en tres manifiestos sin que el
 * directorio exista, un `contextFileName: GEMINI.md` que no está, y un `.mcp.json`
 * que su propio generador lista como target y nunca escribió. Generar config no
 * valida nada, y su detector de drift nunca corrió porque no hay CI.
 *
 * La regla que sale de ahí: declarar ≠ verificar. Esto es lo único que separa
 * "soportamos N CLIs" de "declaramos N CLIs".
 */

export type Status = "ok" | "warn" | "fail"
export type Check = { name: string; status: Status; detail: string }

const ok = (name: string, detail: string): Check => ({ name, status: "ok", detail })
const fail = (name: string, detail: string): Check => ({ name, status: "fail", detail })
const warn = (name: string, detail: string): Check => ({ name, status: "warn", detail })

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))

/** La versión canónica sale de cli-config.yaml, que es la fuente única. */
export function declaredVersion(root: string): string | null {
  try {
    const text = readFileSync(join(root, "cli-config.yaml"), "utf8")
    return text.match(/^ {2}version:\s*"(\d+\.\d+\.\d+)"/m)?.[1] ?? null
  } catch {
    return null
  }
}

// ── runtime ────────────────────────────────────────────────────────────────

/** Node ≥22.18 corre .ts sin flag; antes de eso hace falta bun. */
const MIN_NODE = [22, 18] as const

export function checkRuntime(): Check {
  const bun = probe("bun", ["--version"])
  if (bun) return ok("runtime", `bun ${bun}`)

  const node = probe("node", ["--version"])
  if (!node) return fail("runtime", "no hay bun ni node — bin/run.sh no puede ejecutar los .ts")

  const [major = 0, minor = 0] = node.replace(/^v/, "").split(".").map(Number)
  const enough = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])
  return enough
    ? ok("runtime", `node ${node}`)
    : fail("runtime", `node ${node} — se necesita ≥${MIN_NODE.join(".")} o bun para ejecutar .ts`)
}

function probe(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

// ── manifiestos: existen, parsean, y las versiones coinciden ───────────────

export function checkManifests(root: string): Check[] {
  const expected = declaredVersion(root)
  if (!expected) return [fail("manifiestos", "cli-config.yaml no existe o no declara una versión válida")]

  const found: { label: string; version: unknown }[] = []
  const checks: Check[] = []

  for (const [rel, extract] of [
    [".claude-plugin/plugin.json", (d: any) => [["version", d.version]]],
    [
      ".claude-plugin/marketplace.json",
      (d: any) => [
        ["metadata.version", d.metadata?.version],
        ["plugins[0].version", d.plugins?.[0]?.version],
      ],
    ],
  ] as const) {
    const path = join(root, rel)
    if (!existsSync(path)) {
      checks.push(fail(rel, "declarado por el generador pero no está en disco"))
      continue
    }
    try {
      for (const [label, version] of extract(readJson(path) as any)) {
        found.push({ label: `${rel} → ${label}`, version })
      }
    } catch {
      checks.push(fail(rel, "no es JSON válido"))
    }
  }

  const desincronizados = found.filter((f) => f.version !== expected)
  checks.push(
    desincronizados.length === 0
      ? ok("versiones", `${expected} en los ${found.length} campos de versión`)
      : fail(
          "versiones",
          `cli-config.yaml dice ${expected}, pero: ${desincronizados
            .map((d) => `${d.label}=${String(d.version)}`)
            .join(", ")} — corré bin/dev/generate-cli-configs.py`,
        ),
  )
  return checks
}

// ── toda ruta declarada existe ─────────────────────────────────────────────

export function checkDeclaredPaths(root: string): Check[] {
  const checks: Check[] = []

  // No llamar a esto `declare`: bun lo parsea como la keyword de declaración
  // ambiente y tira "Unexpected }" varias líneas más abajo. node y tsc lo
  // aceptan sin chistar — la divergencia solo aparece corriendo bajo bun, que es
  // justamente lo que hace checkEntrypoints a través de bin/run.sh.
  const checkPath = (source: string, value: unknown): void => {
    if (typeof value !== "string") return
    const path = join(root, value)
    checks.push(
      existsSync(path) ? ok(source, value) : fail(source, `declara "${value}" y no existe en disco`),
    )
  }

  try {
    checkPath("plugin.json → skills", (readJson(join(root, ".claude-plugin/plugin.json")) as any).skills)
  } catch {
    checks.push(fail("plugin.json", "ilegible"))
  }

  try {
    const oc = readJson(join(root, "opencode.json")) as any
    for (const path of oc.skills?.paths ?? []) checkPath("opencode.json → skills.paths", path)
    for (const path of oc.plugin ?? []) checkPath("opencode.json → plugin", path)
  } catch {
    checks.push(fail("opencode.json", "ilegible"))
  }

  return checks
}

// ── todo hook declarado apunta a un archivo que existe ─────────────────────

export function checkHooks(root: string): Check[] {
  const path = join(root, "hooks/hooks.json")
  if (!existsSync(path)) return [fail("hooks.json", "no existe")]

  let hooks: Record<string, any[]>
  try {
    const doc = readJson(path) as any
    hooks = doc.hooks ?? doc
  } catch {
    return [fail("hooks.json", "no es JSON válido")]
  }

  const eventos = Object.keys(hooks)
  if (eventos.length === 0) {
    // Es exactamente el estado de ankify: el adapter escrito y nunca cableado.
    return [fail("hooks.json", "no registra ningún hook — el adapter existe pero no está cableado")]
  }

  const checks: Check[] = []
  for (const [evento, entradas] of Object.entries(hooks)) {
    for (const entrada of entradas) {
      for (const hook of entrada.hooks ?? []) {
        const command = String(hook.command ?? "").replaceAll("${CLAUDE_PLUGIN_ROOT}", root)
        const referencias = command.match(/\S+\.(ts|sh|js|mjs)\b/g) ?? []

        if (referencias.length === 0) {
          checks.push(warn(`${evento}`, `sin archivo reconocible en el comando: ${command.slice(0, 60)}`))
          continue
        }
        for (const ref of referencias) {
          checks.push(existsSync(ref) ? ok(evento, ref.replace(root + "/", "")) : fail(evento, `apunta a ${ref}, que no existe`))
        }
      }
    }
  }
  return checks
}

// ── todo entrypoint arranca de verdad ──────────────────────────────────────

/** Invocaciones sin efectos: solo prueban que el archivo cargue y corra. */
const ENTRYPOINTS: { label: string; script: string; args: string[]; expect: number }[] = [
  { label: "hook.ts", script: "src/adapters/claude-code/hook.ts", args: ["pre-tool-use"], expect: 0 },
  { label: "todo-guard.ts", script: "src/cli/todo-guard.ts", args: ["check"], expect: 0 },
  { label: "todo-store.ts", script: "src/cli/todo-store.ts", args: ["mode"], expect: 0 },
  { label: "post-commit.ts", script: "src/cli/post-commit.ts", args: [], expect: 0 },
]

export function checkEntrypoints(root: string): Check[] {
  const run = join(root, "bin/run.sh")
  if (!existsSync(run)) return [fail("bin/run.sh", "no existe: ningún entrypoint puede ejecutarse")]

  return ENTRYPOINTS.map(({ label, script, args, expect }) => {
    try {
      execFileSync("bash", [run, join(root, script), ...args], {
        input: "", // stdin vacío y cerrado: los que leen payload salen enseguida
        stdio: ["pipe", "ignore", "pipe"],
        timeout: 15_000,
      })
      return ok(label, "arranca")
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === expect) return ok(label, "arranca")
      const stderr = String((error as { stderr?: Buffer }).stderr ?? "").trim().split("\n")[0] ?? ""
      return fail(label, `salió ${status ?? "?"} (esperaba ${expect})${stderr ? ` — ${stderr.slice(0, 80)}` : ""}`)
    }
  })
}

/** El entrypoint de OpenCode: que resuelva sus imports y devuelva los hooks. */
export async function checkOpenCodeEntrypoint(root: string): Promise<Check> {
  const path = join(root, ".opencode/plugins/todo-plugin.ts")
  if (!existsSync(path)) return fail("opencode entrypoint", "no existe")

  const esperados = [
    "shell.env",
    "config",
    "tool.execute.before",
    "tool.execute.after",
    "experimental.chat.system.transform",
  ]
  try {
    const mod = (await import(path)) as { default?: (input: unknown) => Promise<Record<string, unknown>> }
    const hooks = await mod.default?.({ directory: process.cwd() })
    const faltan = esperados.filter((name) => typeof hooks?.[name] !== "function")
    return faltan.length === 0
      ? ok("opencode entrypoint", `${esperados.length} hooks`)
      : fail("opencode entrypoint", `faltan hooks: ${faltan.join(", ")}`)
  } catch (error) {
    return fail("opencode entrypoint", `no carga: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── skills y agentes declaran lo que hace falta para descubrirlos ──────────

export function checkSkillsAndAgents(root: string): Check[] {
  const checks: Check[] = []

  const skills = discoverSkills(root)
  checks.push(
    skills.length === 0
      ? fail("skills", "no se descubrió ninguna")
      : ok("skills", `${skills.length}: ${skills.map((s) => s.slug).join(", ")}`),
  )
  for (const skill of skills) {
    if (!skill.description) checks.push(fail(`skills/${skill.slug}`, "sin description en el frontmatter"))
  }

  const agents = discoverAgents(root)
  checks.push(
    agents.length === 0
      ? warn("agents", "no se descubrió ninguno")
      : ok("agents", agents.map((a) => a.slug).join(", ")),
  )
  for (const agent of agents) {
    if (!agent.description) checks.push(fail(`agents/${agent.slug}`, "sin description en el frontmatter"))
    if (!agent.body) checks.push(fail(`agents/${agent.slug}`, "sin cuerpo: el prompt quedaría vacío en OpenCode"))
  }

  return checks
}

// ── el preámbulo de las skills ─────────────────────────────────────────────

const GUARD_OPEN = /todo-guard\.sh"?\s+open/
const STORE_CALL = /todo-store\.sh"/
const TODO_WRITE = /\.todo\/(TODO|DOING|DONE|DISCARDED|config)\./

/**
 * Toda skill que toque `.todo/` tiene que abrir la ventana del guard ANTES de
 * hacerlo, o el guard la bloquea a ella misma.
 *
 * Es la falla más fácil de introducir sin darse cuenta: se escribe una skill
 * nueva copiando otra, se omiten las primeras líneas, y falla recién cuando un
 * usuario la invoca. Chequearlo acá lo vuelve imposible de olvidar.
 *
 * El orden importa: `todo-store create` escribe un `<id>/.todo/config.json`, así
 * que también pasa por el guard. Abrir la ventana después de resolver el
 * proyecto llega tarde.
 */
export function checkSkillPreamble(root: string): Check[] {
  const checks: Check[] = []

  const documentos = [
    ...discoverSkills(root).map((s) => ({ label: `skills/${s.slug}`, path: join(root, "skills", s.slug, "SKILL.md") })),
    ...discoverAgents(root).map((a) => ({ label: `agents/${a.slug}`, path: join(root, "agents", `${a.slug}.md`) })),
  ]

  for (const { label, path } of documentos) {
    let texto: string
    try {
      texto = readFileSync(path, "utf8")
    } catch {
      checks.push(fail(label, "no se puede leer"))
      continue
    }

    const usaStore = STORE_CALL.test(texto)
    const escribe = TODO_WRITE.test(texto)
    if (!usaStore && !escribe) continue // solo lectura (todo-health): nada que abrir

    const lineas = texto.split("\n")
    const abre = lineas.findIndex((l) => GUARD_OPEN.test(l))
    if (abre === -1) {
      checks.push(fail(label, "toca .todo/ y nunca abre la ventana del guard — se bloquea a sí misma"))
      continue
    }

    const primerStore = lineas.findIndex((l) => STORE_CALL.test(l))
    if (primerStore !== -1 && primerStore < abre) {
      checks.push(
        fail(label, `usa todo-store en la línea ${primerStore + 1} y abre la ventana recién en la ${abre + 1}`),
      )
      continue
    }
    checks.push(ok(label, `abre la ventana en la línea ${abre + 1}`))
  }

  return checks
}

export async function runConformance(root: string = PLUGIN_ROOT): Promise<Check[]> {
  return [
    checkRuntime(),
    ...checkManifests(root),
    ...checkDeclaredPaths(root),
    ...checkHooks(root),
    ...checkSkillsAndAgents(root),
    ...checkSkillPreamble(root),
    ...checkEntrypoints(root),
    await checkOpenCodeEntrypoint(root),
  ]
}

export const worstStatus = (checks: Check[]): Status =>
  checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok"
