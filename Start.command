#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js LTS from https://nodejs.org/ and open this file again."
  printf "Press Enter to close…"
  read -r answer
  exit 1
fi
node scripts/start.mjs
result=$?
if [ "$result" -ne 0 ]; then
  printf "Press Enter to close…"
  read -r answer
fi
exit "$result"
