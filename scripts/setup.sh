#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> Installing client dependencies"
(cd apps/client && npm install)
echo "==> Installing server dependencies"
(cd apps/server && npm install)
echo "==> Done. Set DATABASE_URL for the server (optional, falls back to in-memory LRS store)."
echo "    Start server: npm run dev:server"
echo "    Start client: npm run dev:client"
