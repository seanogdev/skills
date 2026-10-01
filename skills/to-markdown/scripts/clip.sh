#!/usr/bin/env bash
# Copy prose to the clipboard as chat-friendly markdown.
# Flattens markdown headings to bold. With --quote, also prefixes every line with "> ".
# Usage: clip.sh [--quote] < message.md
#        clip.sh [--quote] <<'EOF'
#        message text
#        EOF

set -uo pipefail

command -v pbcopy >/dev/null || { echo "clip.sh: pbcopy is required (macOS only)" >&2; exit 2; }

quote=0
case "${1:-}" in
  --quote) quote=1 ;;
  "") ;;
  *) echo "clip.sh: unknown option: $1" >&2; exit 2 ;;
esac

sed -E 's/^#{1,6}[[:space:]]+(.*)$/**\1**/' \
  | if (( quote )); then
      awk '{ if (length($0) == 0) print ">"; else print "> " $0 }'
    else
      cat
    fi \
  | pbcopy
