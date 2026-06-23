#!/usr/bin/env bash
set -euo pipefail

: "${username:?username is required — usage: username=<name> password=<password> ./register_new.sh}"
: "${password:?password is required — usage: username=<name> password=<password> ./register_new.sh}"

exec docker compose exec -T \
  -e username="$username" \
  -e password="$password" \
  app node dist/scripts/registerUser.js
