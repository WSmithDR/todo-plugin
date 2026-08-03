#!/usr/bin/env python3
"""
generate-cli-configs.py — Lee cli-config.yaml y regenera los manifiestos de
todos los CLIs desde una sola fuente de verdad.

Uso:
  python3 bin/dev/generate-cli-configs.py            # regenera
  python3 bin/dev/generate-cli-configs.py --check    # dry-run, exit 1 si hay drift
  python3 bin/dev/generate-cli-configs.py --list     # imprime los paths que genera

Genera:
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  opencode.json

La versión no se bumpea acá: la escribe el hook post-commit en cli-config.yaml y
después llama a este script. Ver bin/dev/git-hooks/post-commit.

Para agregar un CLI: escribí una gen_*() que devuelva el dict del manifiesto y
sumala a TARGETS. Solo agregá el CLI si verificaste que el plugin realmente
funciona ahí — un manifiesto que declara capacidades inexistentes es peor que no
tenerlo (ver "Se evita" en el spec de migración multi-CLI).
"""

import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("ERROR: PyYAML requerido — pip3 install pyyaml")

# parents[2] y no parent.parent: este archivo está en bin/dev/, así que dos
# saltos dan bin/, no la raíz. Es el bug que tiene ankify/bin/dev/bump-version.py,
# donde --check y --sync fallan al arrancar porque el script se movió de bin/ a
# bin/dev/ y el cálculo no lo siguió.
ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = ROOT / "cli-config.yaml"


def load_cfg() -> dict:
    if not CONFIG_FILE.exists():
        sys.exit(f"ERROR: no se encuentra {CONFIG_FILE}")
    return yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8"))


# ── Un generador por manifiesto ────────────────────────────────────────────


def gen_claude_plugin_json(cfg: dict) -> dict:
    p = cfg["plugin"]
    doc = {
        "name": p["name"],
        "version": p["version"],
        "description": p["description"],
        "author": p["author"],
    }
    for key in ("repository", "homepage", "license", "keywords"):
        if p.get(key):
            doc[key] = p[key]
    doc["skills"] = cfg["paths"]["skills"]
    return doc


def gen_marketplace_json(cfg: dict) -> dict:
    p, m = cfg["plugin"], cfg["marketplace"]
    return {
        "name": p["name"],
        "owner": m["owner"],
        "metadata": {
            "description": m["metadata_description"],
            "version": p["version"],
        },
        "plugins": [
            {
                "name": p["name"],
                "source": m.get("source", "./"),
                "description": m["entry_description"],
                "version": p["version"],
                "author": m["author"],
                "category": m["category"],
                "keywords": p["keywords"],
            }
        ],
    }


def gen_opencode_json(cfg: dict) -> dict:
    oc = cfg["opencode"]
    doc = {"$schema": oc["schema"], "skills": {"paths": oc["skills_paths"]}}
    if oc.get("plugins"):
        doc["plugin"] = oc["plugins"]
    return doc


TARGETS = {
    ".claude-plugin/plugin.json": gen_claude_plugin_json,
    ".claude-plugin/marketplace.json": gen_marketplace_json,
    "opencode.json": gen_opencode_json,
}


# ── Orquestación ───────────────────────────────────────────────────────────


def render(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    # --list existe para que el hook post-commit stagee exactamente lo que este
    # script genera, sin duplicar la lista en bash (donde se desincronizaría al
    # agregar un CLI).
    if "--list" in argv:
        print("\n".join(TARGETS))
        return 0

    check = "--check" in argv
    cfg = load_cfg()
    drift = 0

    for rel, gen in TARGETS.items():
        path = ROOT / rel
        content = render(gen(cfg))

        if not check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            print(f"  ✓ {rel}")
            continue

        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == content:
            print(f"  ✓ {rel}")
        else:
            print(f"  ✗ {rel} — {'desactualizado' if current is not None else 'no existe'}")
            drift += 1

    if check:
        if drift:
            print(f"\n✗ drift: {drift}/{len(TARGETS)} manifiesto(s) ≠ cli-config.yaml")
            print("  Corré: python3 bin/dev/generate-cli-configs.py")
            return 1
        print(f"\n✓ {len(TARGETS)} manifiestos sincronizados con cli-config.yaml")
        return 0

    print(f"\nListo. {len(TARGETS)} manifiestos regenerados desde cli-config.yaml.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
