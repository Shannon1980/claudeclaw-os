---
name: pr-check
description: Review the current branch against ClaudeClaw public-template rules before opening a PR. Use before gh pr create, or when asked to check a PR for leaked secrets, personal data, or deploy commands.
disable-model-invocation: true
context: fork
---

# pr-check

Review this branch against ClaudeClaw public-template safety rules before anyone opens a PR. You are a gate, not a cheerleader. Be direct. No em dashes. No "Certainly!", "Great question!", "I'd be happy to", or sycophancy.

Opening a PR is the end of the job. Do not merge. Do not deploy.

## Steps

### 1. Resolve the repo root

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

Never use `find`. Work from `$PROJECT_ROOT`.

### 2. Confirm you are not on main

```bash
git branch --show-current
```

If the current branch is `main` or `master`, stop. Tell the user to move the work to a branch. Do not continue.

### 3. Collect the change

Run all of these:

```bash
git status --short
git diff --cached
git diff
```

If `origin/main` exists:

```bash
git rev-parse --verify origin/main
git log origin/main...HEAD --oneline
```

Skip the log command if `origin/main` is missing.

### 4. Existing PR

If a PR already exists for this branch:

```bash
gh pr view
gh pr diff
```

Include that diff in the review.

### 5. Review against the checklist

Read `.claude/skills/pr-check/checklist.md` and score every item.

For each item mark **PASS** or **FAIL** with evidence (file path, and a short quote or hunk when it fails).

### 6. Automatic FAIL conditions

FAIL if any of these appear in the staged or unstaged diff (or in `gh pr diff` when a PR exists):

- `store/` contents, `store/waweb/`, `*.db`, `*.db-wal`, `*.db-shm`
- `.env` (`.env.example` is allowed)
- Real names, home paths, or vault paths that replace `[YOUR NAME]`, `[YOUR ASSISTANT NAME]`, `[YOUR_OBSIDIAN_VAULT_PATH]`, `__PROJECT_DIR__`, or `__HOME__`
- Personal `agents/*/CLAUDE.md` or `agents/*/agent.yaml` (only `_template` and `*.example` may be committed)
- Deploy/ship commands being **added** as something an agent should run unattended:
  `npm run electron:build`, `npm run migrate` against the live store, `launchctl bootstrap` / `launchctl bootout`, `npm publish`, `gh release create`, `git push` to main, `--no-verify`

FAIL if `CLAUDE.md` is in the diff and no longer contains `[YOUR NAME]` placeholders.

### 7. Report

Print every checklist item as PASS or FAIL with a file path.

If any item FAILs, print what to fix and stop. Do not open a PR.

If every item PASSes, print a short summary that ends with: safe to `gh pr create`.

Remind the user: opening the PR is the end of the job. Do not merge. Do not deploy.

## Output shape

```
pr-check  branch: <name>

PASS  Branch
PASS  Secrets and runtime data
FAIL  Public template placeholders
      evidence: CLAUDE.md (replaced [YOUR NAME] with a real name)

...

Verdict: FIX THESE, then re-run. Do not open a PR.
```

or, when clean:

```
pr-check  branch: <name>
All checks PASS.
safe to `gh pr create`

Opening the PR is the end of the job. Do not merge. Do not deploy.
```
