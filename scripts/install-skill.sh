#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$ROOT/skills/websearch"

link_skill() {
  local destination="$1"
  mkdir -p "$(dirname "$destination")"
  if [[ -L "$destination" ]]; then
    rm "$destination"
  elif [[ -e "$destination" ]]; then
    echo "Refusing to overwrite existing skill: $destination" >&2
    return 1
  fi
  ln -s "$SKILL_SRC" "$destination"
}

link_skill "${CODEX_HOME:-$HOME/.codex}/skills/websearch"
link_skill "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/websearch"

echo "Linked websearch skill into Codex and Claude Code skill directories."
