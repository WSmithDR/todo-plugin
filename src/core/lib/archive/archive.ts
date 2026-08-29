import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Rotación por año de DONE.md y DISCARDED.md.
 *
 * Los dos crecen y no se podan nunca: todo lo que se cierra queda para siempre.
 * A los años, lo que era el registro de un proyecto es un archivo que hay que
 * leer entero para responder "qué se hizo este mes" — que es justo lo que hace
 * bitacora en cada informe. La rotación deja el año en curso donde estaba y manda
 * lo viejo a `<NOMBRE>-<año>.md`, al lado, sin perder nada.
 */

const ROTATABLE = ["DONE.md", "DISCARDED.md"] as const

export type Rotation = { file: string; year: number; moved: number }

/**
 * El año de cierre de un bloque: la ÚLTIMA fecha que aparece.
 *
 * En los dos formatos la última fecha es la del cierre —`resuelto: … · <ISO>` en
 * DONE, `_Descartado YYYY-MM-DD:_` en DISCARDED— y la primera es la de creación.
 * Rotar por creación mandaría al archivo del año pasado algo que se cerró ayer.
 */
export function closingYear(block: string): number | null {
  const dates = block.match(/\d{4}-\d{2}-\d{2}/g)
  if (dates === null) return null
  const last = dates[dates.length - 1]
  return last === undefined ? null : Number(last.slice(0, 4))
}

/** Un bloque por item: la línea `- …` más sus líneas de continuación. */
function splitBlocks(body: string[]): string[][] {
  const blocks: string[][] = []
  for (const line of body) {
    if (line.startsWith("- ") || blocks.length === 0) blocks.push([line])
    else blocks[blocks.length - 1]?.push(line)
  }
  return blocks
}

/**
 * Mueve a `<NOMBRE>-<año>.md` todo lo cerrado antes de `currentYear`.
 *
 * Un bloque sin fecha se queda donde está: sin poder fecharlo, moverlo es
 * perderlo de vista. Idempotente — correrla dos veces no mueve nada la segunda.
 */
export function rotateArchives(cwd: string, currentYear: number): Rotation[] {
  const rotations: Rotation[] = []

  for (const name of ROTATABLE) {
    const path = join(cwd, ".todo", name)
    if (!existsSync(path)) continue

    const lines = readFileSync(path, "utf8").split("\n")
    const start = lines.findIndex((line) => line.startsWith("- "))
    if (start === -1) continue

    const header = lines.slice(0, start)
    const blocks = splitBlocks(lines.slice(start))

    const byYear = new Map<number, string[][]>()
    const stay: string[][] = []
    for (const block of blocks) {
      const year = closingYear(block.join("\n"))
      if (year === null || year >= currentYear) stay.push(block)
      else byYear.set(year, [...(byYear.get(year) ?? []), block])
    }
    if (byYear.size === 0) continue

    for (const [year, moved] of byYear) {
      const archive = join(cwd, ".todo", name.replace(".md", `-${year}.md`))
      const title = (header[0] ?? `# ${name.replace(".md", "")}`).replace(/^#\s*/, "")
      const previo = existsSync(archive) ? readFileSync(archive, "utf8").trimEnd() : `# ${title} — ${year}`
      writeFileSync(archive, `${previo}\n${moved.map((b) => b.join("\n")).join("\n")}\n`)
      rotations.push({ file: name, year, moved: moved.length })
    }

    writeFileSync(path, `${[...header, ...stay.map((b) => b.join("\n"))].join("\n").trimEnd()}\n`)
  }

  return rotations
}
