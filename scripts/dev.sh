#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
(cd apps/server && npm run dev) &
(cd apps/client && npm run dev) &
wait
