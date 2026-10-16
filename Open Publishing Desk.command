#!/bin/bash
cd "$(dirname "$0")"
exec bash scripts/runtime.sh scripts/desk.py --open
