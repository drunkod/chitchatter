#!/usr/bin/env bash
# The complete verification matrix, in dependency order. Run from repo root:
#   bash snippets/duet-e2e/run-all.sh
set -e

echo '── 1/6 static checks ──────────────────────────────'
npm run check:types
npm run lint

echo '── 2/6 unit tests (story schema validation) ───────'
npm test -- --run

echo '── 3/6 classic E2E (novella, non-duet) ────────────'
npx playwright test e2e/tests/visual-novel.test.ts:23 --project=chromium --workers=1

echo '── 4/6 duet E2E (all four novellas + gating) ──────'
npx playwright test --config=playwright.duet.config.ts --workers=1

echo '── 5/6 minimal-mode demo ──────────────────────────'
node snippets/demo-playbook/demo-minimal.mjs

echo '── 6/6 four-novella browser demo (headed) ─────────'
node snippets/demo-playbook/demo-novellas.mjs

echo 'ALL GREEN'
