#!/bin/zsh
set -eu

REPO_DIR="/Users/you/github/oss/drawio-mcp"
COMPOSE_CMD="docker compose --profile tunnel up -d"
MAX_ATTEMPTS=60
SLEEP_SECONDS=5

cd "$REPO_DIR"

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  if docker info >/dev/null 2>&1; then
    exec /bin/zsh -lc "$COMPOSE_CMD"
  fi

  sleep "$SLEEP_SECONDS"
  attempt=$((attempt + 1))
done

echo "Docker did not become ready in time." >&2
exit 1
