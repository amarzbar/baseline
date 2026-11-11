#!/bin/sh
# Run from cron on Mavis every few minutes:
#   */5 * * * * /path/to/baseline/scripts/auto-update.sh >> /path/to/baseline/auto-update.log 2>&1
# Pulls the latest compose file from main and the latest image from GHCR
# (built by .github/workflows/docker.yml). `docker compose up -d` only
# recreates the container when the image changed, so most runs do nothing.
set -e
cd "$(dirname "$0")/.."
exec 9>/tmp/baseline-auto-update.lock
flock -n 9 || exit 0

git pull -q --ff-only
docker compose pull -q
docker compose up -d --remove-orphans 2>&1 | grep -v -E 'Running|up-to-date' || true
docker image prune -f >/dev/null
