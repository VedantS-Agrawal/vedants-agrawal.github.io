#!/bin/bash
# Saves your RENPHO login: the e-mail goes to .local/renpho.json, the password to the macOS Keychain (never to a file).
cd "$(dirname "$0")/.." && mkdir -p .local
read -r -p "RENPHO account e-mail: " EMAIL
[ -z "$EMAIL" ] && { echo "Nothing saved."; exit 1; }
# `security` asks for the password itself; -T lets the scheduled sync read it without a dialog.
security add-generic-password -U -a "$EMAIL" -s "renpho-personal-site" -w -T /usr/bin/security || { echo "The password was not saved."; exit 1; }
umask 077
EMAIL="$EMAIL" /usr/bin/python3 -c 'import json,os; print(json.dumps({"email": os.environ["EMAIL"]}))' > .local/renpho.json
echo "Saved. The next sync reads your RENPHO weight (experimental; COROS stays the fallback)."
