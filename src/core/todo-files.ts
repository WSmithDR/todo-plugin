import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Lectura y parseo de los archivos de `.todo/`. Nadie más los interpreta. */

export type OpenItem = {
  /** El texto en negrita del item. */
  title: string
  /** La línea completa: título, descripción y metadata. */
  text: string
}

/** `- [ ] **Título** — descripción` */
export function openItems(markdown: string): OpenItem[] {
  const items: OpenItem[] = []
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("- [ ]")) continue
    const match = line.match(/^- \[ \] \*\*([^*]+)\*\*/)
    // Sin negrita se usa la línea entera como título: es preferible a descartar
    // el item y que desaparezca de los conteos.
    items.push({ title: match ? match[1]!.trim() : line, text: line })
  }
  return items
}

export const openItemTitles = (markdown: string): string[] => openItems(markdown).map((item) => item.title)

/** Un `.todo/<archivo>` que no existe se lee como vacío: no todos existen siempre. */
export function readTodoFile(cwd: string, name: string): string {
  try {
    return readFileSync(join(cwd, ".todo", name), "utf8")
  } catch {
    return ""
  }
}

export const completedCount = (markdown: string): number =>
  markdown.split("\n").filter((line) => line.startsWith("- [x]")).length
