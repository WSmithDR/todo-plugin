import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PLUGIN_ROOT } from "../paths/paths.ts"

/**
 * Descubre las skills y los agentes del plugin leyendo su frontmatter.
 *
 * Los archivos se declaran UNA vez, en el formato neutral que leen todos los
 * CLIs, y cada adapter los traduce a lo suyo. No hay copias que se desincronicen.
 */

export type Discovered = {
  /** Nombre del directorio (skills) o del archivo sin .md (agentes). */
  slug: string
  name: string
  description: string
  /** El cuerpo sin frontmatter. Lo consume el adapter de OpenCode como `prompt`. */
  body: string
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/

export function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const match = content.match(FRONTMATTER)
  if (!match) return { fields: {}, body: content.trim() }

  const fields: Record<string, string> = {}
  for (const line of match[1]!.split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) {
      fields[line.slice(0, i).trim()] = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
    }
  }
  return { fields, body: content.slice(match[0].length).trim() }
}

/** `skills/<slug>/SKILL.md` */
export function discoverSkills(root: string = PLUGIN_ROOT): Discovered[] {
  return scan(join(root, "skills"), (dir) =>
    dir.isDirectory() ? { slug: dir.name, file: join(dir.name, "SKILL.md") } : null,
  )
}

/** `agents/<slug>.md` */
export function discoverAgents(root: string = PLUGIN_ROOT): Discovered[] {
  return scan(join(root, "agents"), (entry) =>
    entry.isFile() && entry.name.endsWith(".md")
      ? { slug: entry.name.slice(0, -3), file: entry.name }
      : null,
  )
}

function scan(
  dir: string,
  pick: (entry: { name: string; isFile(): boolean; isDirectory(): boolean }) => { slug: string; file: string } | null,
): Discovered[] {
  // Un directorio ausente devuelve [] a propósito, pero eso hace invisible el
  // caso "la ruta está mal": el conformance check de la fase 4 es el que tiene
  // que gritar, no esta función.
  if (!existsSync(dir)) return []

  const found: Discovered[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const hit = pick(entry)
    if (!hit) continue
    const path = join(dir, hit.file)
    if (!existsSync(path)) continue

    const { fields, body } = parseFrontmatter(readFileSync(path, "utf8"))
    found.push({
      slug: hit.slug,
      name: fields.name || hit.slug,
      description: fields.description || "",
      body,
    })
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug))
}
