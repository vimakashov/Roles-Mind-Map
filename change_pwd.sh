#!/usr/bin/env bash
set -euo pipefail

: "${username:?username is required — usage: username=<name> password=<password> ./change_pwd.sh}"
: "${password:?password is required — usage: username=<name> password=<password> ./change_pwd.sh}"

exec docker compose exec -T \
  -e username="$username" \
  -e password="$password" \
  app node dist/scripts/changePassword.js
