#!/usr/bin/env bash
# Run the irctest IRC/IRCv3 conformance suite against CFCord.
#
# First-time setup (clones irctest + creates a venv under .compliance/):
#   scripts/run-irctest.sh --setup
#
# Run everything Ergo is tested against:
#   scripts/run-irctest.sh
#
# Extra args go straight to pytest, e.g.:
#   scripts/run-irctest.sh -k cap -x
#   scripts/run-irctest.sh irctest/server_tests/chathistory.py
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMP="$ROOT/.compliance"

if [[ "${1:-}" == "--setup" ]]; then
  mkdir -p "$COMP"
  [[ -d "$COMP/irctest" ]] || git clone --depth 1 https://github.com/progval/irctest.git "$COMP/irctest"
  [[ -d "$COMP/venv" ]] || python3 -m venv "$COMP/venv"
  "$COMP/venv/bin/pip" install -q pytest pytest-xdist pytest-timeout ecdsa filelock websockets
  echo "irctest ready."
  exit 0
fi

# Build the worker bundle once up front (shared by all parallel workers).
(cd "$ROOT" && npm run build)
export CFCORD_SKIP_BUNDLE=1

cd "$COMP/irctest"
MARKERS="${IRCTEST_MARKERS:-(Ergo or not implementation-specific) and not deprecated}"

# Default to the whole server test suite when no explicit path is given.
HAS_PATH=0
for a in "$@"; do [[ "$a" == irctest/* ]] && HAS_PATH=1; done
TARGET=()
[[ $HAS_PATH -eq 0 ]] && TARGET=(irctest/server_tests)

PYTHONPATH="$ROOT/compliance" exec "$COMP/venv/bin/python" -m pytest \
  --controller cfcord_controller \
  -m "$MARKERS" \
  -p no:cacheprovider --timeout="${IRCTEST_TIMEOUT:-30}" \
  "${TARGET[@]}" "$@"
