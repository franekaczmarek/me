#!/usr/bin/env bash
# Runs every check: backend unit tests, frontend lint/typecheck/unit tests, E2E tests.
# Usage: scripts/test.sh          # everything
#        scripts/test.sh --fast   # skip E2E (used by the pre-commit hook)
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "Backend unit tests (pytest)"
(cd backend && .venv/bin/pytest -q -p no:warnings)

step "Frontend lint"
(cd frontend && npm run --silent lint)

step "Frontend typecheck"
(cd frontend && npm run --silent typecheck)

step "Frontend unit tests (vitest)"
(cd frontend && npm run --silent test)

if [[ "${1:-}" != "--fast" ]]; then
  step "E2E tests (playwright)"
  (cd frontend && npx playwright test)
fi

printf '\n\033[32mAll checks passed.\033[0m\n'
