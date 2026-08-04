#!/usr/bin/env bash
#
# Point this clone at the tracked hooks in .githooks/.
#
# core.hooksPath is repo-level config, so one run covers the main checkout and
# every worktree under .claude/worktrees/. Hooks are NOT installed by cloning —
# git deliberately never runs code from a fresh clone — so this has to be run
# once per machine.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

chmod +x .githooks/*
git config core.hooksPath .githooks

# A worktree-local core.hooksPath BEATS the repo-level one, and worktree tooling
# (Claude Code's included) sets it to the empty .git/hooks — which silently
# disables every hook in the checkouts where agents actually work. Clear those
# overrides so the guard is not bypassable by working in a worktree.
if [ "$(git config --get extensions.worktreeConfig || true)" = "true" ]; then
  git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}' | while read -r wt; do
    [ -d "$wt" ] || continue
    if git -C "$wt" config --worktree --get core.hooksPath >/dev/null 2>&1; then
      git -C "$wt" config --worktree --unset-all core.hooksPath 2>/dev/null || true
      echo "cleared worktree-local core.hooksPath override in $wt"
    fi
  done
fi

echo "hooks installed: core.hooksPath -> .githooks"
echo "  pre-commit  refuses commits on main/master"
echo "  pre-push    refuses pushes to main/master"
echo
echo "verify: git config --get core.hooksPath"
