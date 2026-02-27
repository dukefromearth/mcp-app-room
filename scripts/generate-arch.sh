#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-docs/generated}"
MODE="${2:-}"
CONFIG_PATH="${ARCH_CONFIG_PATH:-tools/arch/arch.config.json}"

if [[ ! -f "${ROOT_DIR}/${CONFIG_PATH}" ]]; then
  echo "Missing architecture config: ${CONFIG_PATH}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required" >&2
  exit 1
fi

cd "${ROOT_DIR}"
mkdir -p "${OUTPUT_DIR}"

INCLUDE_ONLY="$(
  node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(c.includeOnly || "^src");' "${CONFIG_PATH}"
)"

EXCLUDE_REGEX="$(
  node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const ex=(c.exclude || []).filter(Boolean); process.stdout.write(ex.length ? ex.join("|") : "^$");' "${CONFIG_PATH}"
)"

ROOTS=()
while IFS= read -r root; do
  [[ -n "${root}" ]] || continue
  ROOTS+=("${root}")
done < <(
  node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const roots=(c.roots && c.roots.length) ? c.roots : ["src"]; for (const r of roots) console.log(r);' "${CONFIG_PATH}"
)

echo "[arch] generating dependency graph -> ${OUTPUT_DIR}/deps.mmd"
npx depcruise \
  --no-config \
  --include-only "${INCLUDE_ONLY}" \
  --exclude "${EXCLUDE_REGEX}" \
  --output-type mermaid \
  --output-to "${OUTPUT_DIR}/deps.mmd" \
  "${ROOTS[@]}"

if [[ "${MODE}" != "--deps-only" ]]; then
  echo "[arch] generating type/call graphs -> ${OUTPUT_DIR}"
  node tools/arch/generate.mjs "${OUTPUT_DIR}" "${CONFIG_PATH}"
fi

if [[ "${ARCH_RENDER:-0}" == "1" ]]; then
  if command -v mmdc >/dev/null 2>&1; then
    for file in "${OUTPUT_DIR}"/*.mmd; do
      [[ -f "${file}" ]] || continue
      mmdc -i "${file}" -o "${file%.mmd}.svg" >/dev/null
    done
  else
    echo "[arch] ARCH_RENDER=1 but mmdc not found; skipping SVG rendering"
  fi
fi
