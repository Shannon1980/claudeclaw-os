# 07-05 Summary — Final cutover and live proof

**Status:** Complete (live-verified 2026-06-18 14:48)
**Requirements:** SCH-01, SCH-02, SCH-03, SCH-04 — all satisfied in production.

## What was delivered

The single-scheduler cutover went live: ClaudeClaw's `aos` service is now the sole runner for the agentic-os `cron/jobs/*.md`, the in-process Command Centre engine is gated off, and a real job fired cross-process exactly once with Slack + DB parity.

### Cutover steps performed
- **Deployed 07-01→04 code** to the live checkout (fast-forward of `claude/phase-07-single-scheduler-execute` to the phase-07 work; `main` bot rebuilt + restarted on the new code).
- **Migration applied to live DB.** The live DB carried a *phantom* `v1.2.0` (`.applied.json`) written by the since-deleted `priceless-ramanujan` branch, which made `migrate.ts` skip our `v1.1.1` (sorts below). Re-versioned the migration **v1.1.1 → v1.2.1**; `npm run migrate` then added the 6 aos-cron columns idempotently (`source` already existed; `prompt_file` left as a harmless orphan). Backup at `store/claudeclaw.db.pre-v1.2.1.bak`.
- **CRON_IN_PROCESS gate** added to `agentic-os/command-centre/src/instrumentation.ts` (D-01, opt-out). Committed scoped in the agentic-os repo (commit 0c91b7f).
- **Fleet launchd migration** via `install-launchd.sh` — but first fixed a latent bug: `main/comms/content/ops/research` used `__PROJECT_DIR__/logs/*.log` (spaced path → launchd exit 78) and `meta` used an unsubstituted `__LOG_DIR__`. Rewrote all to `/tmp/claudeclaw-<agent>.log`. `main`+`social` are healthy; the other fleet agents (no configs/tokens) were unloaded as out-of-scope.
- **Slack send gap closed (new code).** Sub-agents only had a Telegram notify path; on this Slack-only setup the aos cron output could not reach Slack. Added `createSlackSender` — a Web-API-only poster (no Socket Mode listener, so no double event handling with main). `index.ts` routes a sub-agent whose token is `SLACK_BOT_TOKEN` through it. (commit 0246dc7, +3 tests)
- **aos provisioned.** Live config is `~/.claudeclaw/agents/aos/agent.yaml` (external dir wins over repo); added `telegram_bot_token_env: SLACK_BOT_TOKEN`. Loaded only `com.claudeclaw.aos` by hand (NOT the fleet script).
- **Cleaned stale rows.** Deleted 8 `agent_id='main'` `source='aos-cron'` rows (no `job_path`) left by the deleted branch — they would have caused failed/double fires from the main bot.

## Live proof (weekly-memory-gaps, triggered 14:46, finished 14:48)
- **SCH-04 exactly-once:** one `Firing aos-cron task` log line; only the aos process claimed it via `claimDueTask` (main is agent-scoped, CC engine off).
- **SCH-03 parity:** `last_status=success`, `last_run` + `last_result` recorded; Slack message arrived clean (user-confirmed).
- **D-07:** prompt body re-read from the `.md` at fire time.
- **D-12:** no "Scheduled task running" preamble (0 in log; confirmed in Slack).
- **D-03:** `notify: on_finish` posted the result to Slack as the main bot.
- **SCH-01:** no `cron-runtime-lock.json`; CC in-process engine confirmed off.
- Cadence intact: `next_run` auto-recomputed to next Sun 09:30.

## Deviations / notes for the record
- The cutover hit four live-environment surprises not anticipated by the plan: phantom DB migration version, broken fleet plist log paths, a fully unprovisioned fleet (only main+social have configs/tokens), and sub-agents having no Slack send path. Each is documented above and was fixed.
- Repo-side `agents/aos/agent.yaml` + `.example` were added, but the live agent reads `~/.claudeclaw/agents/aos/agent.yaml` (external dir precedence) — that's where the token env lives.
- The other 6 fleet agents remain unprovisioned; a full fleet bring-up is separate future work (configs + Slack tokens). See memory note "fleet not provisioned".
- `agentic-os/command-centre` must be started with `CRON_IN_PROCESS=0` going forward to keep the old engine off (it's a manual `npm run dev`, not a managed service).
