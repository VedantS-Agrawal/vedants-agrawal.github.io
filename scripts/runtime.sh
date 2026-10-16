#!/bin/bash
SITE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$SITE_ROOT"
exec "$SITE_ROOT/.venv/bin/python" "$@"
