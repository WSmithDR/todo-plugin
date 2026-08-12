import { significantBasename, type OpenItem } from "./todo-files.ts"

/**
 * Detección de tareas abiertas que probablemente ya estén resueltas.
 *
 * La señal es barata y sorprendentemente buena: si una tarea nombra un archivo y
 * ese archivo cambió DESPUÉS de que la tarea se creó, alguien trabajó ahí. No
 * prueba que esté resuelta —por eso el veredicto lo da el usuario, no esto—,
 * pero convierte "revisá 48 items" en "mirá estos 5".
 *
 * El pre-commit ataca el mismo problema en el momento del commit; esto ataca lo
 * que ya se rezagó, que en una lista vieja es casi todo.
 */

export type Change = { sha: string; date: string; subject: string; files: string[] }

export type Candidate = {
  title: string
  created: string
  /**
   * Los archivos que relacionaron, con cuántas tareas abiertas menciona cada uno.
   *
   * `sharedBy: 1` es una relación específica. `sharedBy: 7` quiere decir que ese
   * archivo lo nombra medio TODO.md —un `functions.php`, un cajón de sastre— y
   * entonces la coincidencia no significa gran cosa.
   *
   * Se REPORTA en vez de filtrarse: qué archivo es un cajón de sastre depende del
   * stack, y una lista fija de nombres crece sin fondo. El número lo dice el
   * proyecto solo, y la decisión la toma quien lee.
   */
  files: { name: string; sharedBy: number }[]
  changes: Change[]
}

/** Extensiones que valen como "archivo" dentro del texto de una tarea. */
const FILE_TOKEN = /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|php|py|rb|go|java|kt|sh|bash|sql|css|scss|html|vue|astro|md|json|ya?ml|toml|env)\b/g

/** `_(creado por: X · YYYY-MM-DD …)_` */
export function creationDate(text: string): string | null {
  return text.match(/creado por:[^·]*·\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
}

/**
 * Los archivos que la tarea nombra, sin los que no distinguen nada.
 *
 * Se reusa el filtro del matcher del pre-commit: un item que dice `package.json`
 * relacionaría con cualquier commit del repo.
 */
export function mentionedFiles(text: string): string[] {
  const matches = text.match(FILE_TOKEN) ?? []
  return [...new Set(matches.filter((name) => significantBasename(name) !== null))]
}

/**
 * Cruza los items abiertos contra el historial. `changes` viene del CLI, que es
 * quien habla con git: acá no hay I/O para poder testear el cruce.
 */
export function staleCandidates(items: OpenItem[], changes: Change[]): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = []
  let skipped = 0

  // Cuántas tareas abiertas menciona cada archivo: es lo que separa una relación
  // específica de una que matchea con media lista.
  const menciones = new Map<string, number>()
  for (const item of items) {
    for (const file of mentionedFiles(item.text)) menciones.set(file, (menciones.get(file) ?? 0) + 1)
  }

  for (const item of items) {
    const created = creationDate(item.text)
    const files = mentionedFiles(item.text)
    if (created === null || files.length === 0) {
      skipped++
      continue
    }

    const relevantes = changes.filter(
      (change) => change.date > created && change.files.some((path) => files.includes(basename(path))),
    )
    if (relevantes.length === 0) continue

    const tocados = files
      .filter((file) => relevantes.some((change) => change.files.some((path) => basename(path) === file)))
      .map((name) => ({ name, sharedBy: menciones.get(name) ?? 1 }))

    candidates.push({ title: item.title, created, files: tocados, changes: relevantes })
  }

  return { candidates, skipped }
}

const basename = (path: string): string => path.split("/").pop() ?? path
