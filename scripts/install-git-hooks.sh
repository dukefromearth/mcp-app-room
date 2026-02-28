#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

echo "Installed git hooks path: .githooks"
echo "Pre-commit will run: npm run repo:guard && npm run arch:lint"
