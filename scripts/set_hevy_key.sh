#!/bin/bash
# Saves your Hevy API key to .local/hevy.key (git-ignored, readable only by you). The key is never printed.
cd "$(dirname "$0")/.." && mkdir -p .local
read -r -s -p "Paste your Hevy API key (hevy.com → Settings → Developer), then press Return: " KEY; echo
[ -z "$KEY" ] && { echo "Nothing saved."; exit 1; }
umask 077; printf '%s' "$KEY" > .local/hevy.key
code=$(curl -s -o /dev/null -w '%{http_code}' -H "api-key: $KEY" "https://api.hevyapp.com/v1/workouts/count")
[ "$code" = "200" ] && echo "Saved. Hevy accepted the key." || echo "Saved, but Hevy answered HTTP $code — check the key."
