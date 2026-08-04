#!/usr/bin/env bash
#
# Point this clone at the tracked hooks in .githooks/.
#
# Hooks are NOT installed by cloning — git deliberately never runs code from a
# fresh clone — so this has to be run once per machine.
#
# Two things this gets right that `git config core.hooksPath .githooks` does not:
#
#   1. It sets an ABSOLUTE path into the main checkout. A relative hooksPath
#      resolves against whatever tree is checked out, so the moment a branch
#      lacks .githooks/ the hooks silently stop running — including on every
#      branch cut before these hooks landed. Verified the hard way: with a
#      relative path, `git commit` on main sailed straight through.
#   2. It clears worktree-local overrides. A worktree-local core.hooksPath BEATS
#      the repo-level one, and worktree tooling (Claude Code's included) points
#      it at the empty .git/hooks, which disables every hook in exactly the
#      checkouts where agents do their work.
set -euo pipefail

# The main checkout, not the current worktree: --git-common-dir is shared.
common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir)
main_root=$(dirname "$common_git_dir")
hooks_dir="$main_root/.githooks"

if [ ! -d "$hooks_dir" ]; then
  echo "error: $hooks_dir does not exist." >&2
  echo "  The main checkout ($main_root) is on a branch without .githooks/." >&2
  echo "  Check out a branch that has it (or merge this change to main), then re-run." >&2
  exit 1
fi

chmod +x "$hooks_dir"/*
git config core.hooksPath "$hooks_dir"

if [ "$(git config --get extensions.worktreeConfig || true)" = "true" ]; then
  git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}' | while read -r wt; do
    [ -d "$wt" ] || continue
    if git -C "$wt" config --worktree --get core.hooksPath >/dev/null 2>&1; then
      git -C "$wt" config --worktree --unset-all core.hooksPath 2>/dev/null || true
      echo "cleared worktree-local core.hooksPath override in $wt"
    fi
  done
fi

# Copies in .git/hooks would be shadowed by hooksPath — drop them so there is
# exactly one live source of truth and nobody debugs a stale copy.
for stale in pre-commit pre-push; do
  if [ -f "$common_git_dir/hooks/$stale" ]; then
    rm -f "$common_git_dir/hooks/$stale"
    echo "removed shadowed copy .git/hooks/$stale"
  fi
done

echo "hooks installed: core.hooksPath -> $hooks_dir"
echo "  pre-commit  refuses commits on main/master"
echo "  pre-push    refuses pushes to main/master"
echo
echo "verify:  git config --show-origin --get-all core.hooksPath"
echo "re-run this after any change to .githooks/ so every worktree picks it up."
