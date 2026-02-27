#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

npm run arch:gen

TRACKED_COUNT="$(git ls-files -- docs/generated | wc -l | tr -d ' ')"
if [[ "${TRACKED_COUNT}" == "0" ]]; then
  echo "docs/generated is not tracked yet. Commit generated artifacts before using arch:check." >&2
  git status --short -- docs/generated
  exit 1
fi

if [[ -n "$(git status --porcelain -- docs/generated)" ]]; then
  echo "Architecture artifacts are out of date. Re-run npm run arch:gen and commit docs/generated changes." >&2
  git status --short -- docs/generated
  exit 1
fi
