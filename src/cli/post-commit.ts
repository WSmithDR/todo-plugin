#!/usr/bin/env node
// Git post-commit hook. Red de contención del `--no-verify`: git lo corre
// aunque el commit haya salteado el pre-commit.
//
// No puede abortar nada —el commit ya existe— así que siempre sale 0 y el aviso
// va por stderr.
import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { preCommitMarker } from "../core/git.ts"
import { postCommitReview } from "../core/rules/post-commit/post-commit.ts"
import { projectForRepo, readLastCommit, repoRootOf, resolveProjectDir } from "../core/store.ts"

const cwd = process.cwd()

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

// La marca se consume siempre: si quedara, el próximo commit forzado la
// encontraría y el bypass pasaría inadvertido.
const marker = preCommitMarker(cwd)
const preCommitRan = marker !== "" && existsSync(marker)
if (preCommitRan) rmSync(marker, { force: true })

// Retroactivo: no solo este commit, todos los que no dejaron rastro desde el
// último cierre. Si DONE.md nunca se tocó, se muestran los últimos 20.
const projectDir = resolveProjectDir(cwd)
const centralized = projectDir !== null && projectDir !== cwd
// El punto de registro vive en el config del proyecto (avanza cuando una skill
// cierra algo desde este repo); sin él, cae a la lista amplia de siempre hasta
// la primera registración.
const lastRegistered = centralized
  ? (() => {
      const project = projectForRepo(repoRootOf(cwd))
      return project ? readLastCommit(project.id) : ""
    })()
  : git("log", "-1", "--format=%H", "--", ".todo/DONE.md")
const range = lastRegistered === "" ? ["-20"] : [`${lastRegistered}..HEAD`]
if (centralized) range.length = 0

const unregistered =
  range.length === 0 ? [] : git("log", "--oneline", "--no-merges", ...range).split("\n").filter((line) => line.length > 0)

const decision = postCommitReview({
  hasTodoDir: projectDir !== null,
  preCommitRan,
  reflogSubject: git("reflog", "-1", "--format=%gs"),
  subject: git("log", "-1", "--format=%s"),
  unregistered,
})

if (decision.action !== "allow") process.stderr.write(decision.message + "\n")
process.exit(0)
