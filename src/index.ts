import fs from 'fs';
import path from 'path';

import { loadAgentConfig, listAgentIds, resolveAgentDir, resolveAgentClaudeMd, refreshWarRoomRoster } from './agent-config.js';
import { createBot } from './bot.js';
import { createDiscordBot, type DiscordBot } from './discord-bot.js';
import { createSlackBot, createSlackSender, type SlackBot, type SlackSender } from './slack-bot.js';
import { splitMessage } from './format.js';
import { checkPendingMigrations } from './migrations.js';
import { ALLOWED_CHAT_ID, activeBotToken, STORE_DIR, PROJECT_ROOT, WORKSPACE_ROOT, DATA_DIR, ENV_FILE, CLAUDECLAW_CONFIG, GOOGLE_API_KEY, setAgentOverrides, EMERGENCY_KILL_PHRASE, WARROOM_ENABLED, WARROOM_PORT, TRANSPORT, SLACK_BOT_TOKEN, SLACK_APP_TOKEN, ALLOWED_SLACK_USER_ID, DISCORD_BOT_TOKEN, PRIMARY_CHAT_ID } from './config.js';
import { startDashboard } from './dashboard.js';
import { initDatabase, cleanupOldMissionTasks, insertAuditLog } from './db.js';
import { seedBootstrapPairings } from './pairing.js';
import { initSecurity, setAuditCallback } from './security.js';
import { logger } from './logger.js';
import { cleanupOldUploads } from './media.js';
import { runConsolidation } from './memory-consolidate.js';
import { runDecaySweep } from './memory.js';
import { runWarroomAvatarMigration } from './avatars.js';
import { initOAuthHealthCheck } from './oauth-health.js';
import { initOrchestrator } from './orchestrator.js';
import { initScheduler } from './scheduler.js';
import { syncAosCronJobs } from './aos-cron.js';
import { setTelegramConnected, setSlackConnected, setBotInfo } from './state.js';
import { killProcess, resolveVenvPython } from './platform.js';

// Parse --agent flag
const agentFlagIndex = process.argv.indexOf('--agent');
const AGENT_ID = agentFlagIndex !== -1 ? process.argv[agentFlagIndex + 1] : 'main';

// Export AGENT_ID to env so child processes (schedule-cli, etc.) inherit it
process.env.CLAUDECLAW_AGENT_ID = AGENT_ID;

if (AGENT_ID !== 'main') {
  const agentConfig = loadAgentConfig(AGENT_ID);
  const agentDir = resolveAgentDir(AGENT_ID);
  // An explicit, existing project_dir wins so the agent's runs (scheduled
  // tasks, missions, and the SDK cwd) operate on that project's files and
  // resolve relative-path writes there — not into the agent's own dir. This
  // mirrors resolveAgentRuntime() so the standalone and delegated paths agree.
  const agentCwd =
    agentConfig.projectDir && fs.existsSync(agentConfig.projectDir)
      ? agentConfig.projectDir
      : agentDir;
  const claudeMdPath = resolveAgentClaudeMd(AGENT_ID);
  let systemPrompt: string | undefined;
  if (claudeMdPath) {
    try {
      systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
    } catch { /* no CLAUDE.md */ }
  }
  setAgentOverrides({
    agentId: AGENT_ID,
    botToken: agentConfig.botToken,
    cwd: agentCwd,
    model: agentConfig.model,
    obsidian: agentConfig.obsidian,
    systemPrompt,
    mcpServers: agentConfig.mcpServers,
  });
  logger.info({ agentId: AGENT_ID, name: agentConfig.name }, 'Running as agent');
} else {
  // For main bot: read CLAUDE.md from CLAUDECLAW_CONFIG and inject it as
  // systemPrompt — the same pattern used by sub-agents. Never copy the file
  // into the repo; that defeats the purpose of CLAUDECLAW_CONFIG and risks
  // accidentally committing personal config.
  const externalClaudeMd = path.join(CLAUDECLAW_CONFIG, 'CLAUDE.md');
  if (fs.existsSync(externalClaudeMd)) {
    let systemPrompt: string | undefined;
    try {
      systemPrompt = fs.readFileSync(externalClaudeMd, 'utf-8');
    } catch { /* unreadable */ }
    if (systemPrompt) {
      setAgentOverrides({
        agentId: 'main',
        botToken: activeBotToken,
        cwd: WORKSPACE_ROOT,
        systemPrompt,
      });
      logger.info({ source: externalClaudeMd }, 'Loaded CLAUDE.md from CLAUDECLAW_CONFIG');
    }
  } else if (!fs.existsSync(path.join(PROJECT_ROOT, 'CLAUDE.md'))) {
    logger.warn(
      'No CLAUDE.md found. Copy CLAUDE.md.example to %s/CLAUDE.md and customize it.',
      CLAUDECLAW_CONFIG,
    );
  }
}

const PID_FILE = path.join(STORE_DIR, `${AGENT_ID === 'main' ? 'claudeclaw' : `agent-${AGENT_ID}`}.pid`);

function showBanner(): void {
  const bannerPath = path.join(PROJECT_ROOT, 'banner.txt');
  try {
    const banner = fs.readFileSync(bannerPath, 'utf-8');
    console.log('\n' + banner);
  } catch {
    console.log('\n  ClaudeClaw\n');
  }
}

function acquireLock(): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  try {
    if (fs.existsSync(PID_FILE)) {
      const old = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (!isNaN(old) && old !== process.pid) {
        killProcess(old);
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); } catch { /* ok */ }
      }
    }
  } catch { /* ignore */ }
  fs.writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 });
}

function releaseLock(): void {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

async function main(): Promise<void> {
  
  checkPendingMigrations(PROJECT_ROOT);

  if (AGENT_ID === 'main') {
    showBanner();
  }

  // Slack front-end applies to the main process only; sub-agents (--agent)
  // always use their own Telegram bot token.
  const useSlack = TRANSPORT === 'slack' && AGENT_ID === 'main';

  if (useSlack) {
    if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
      logger.error('Slack transport selected but SLACK_BOT_TOKEN / SLACK_APP_TOKEN are not set. Run npm run setup, or set TRANSPORT=telegram.');
      process.exit(1);
    }
  } else if (!activeBotToken) {
    if (AGENT_ID === 'main') {
      logger.error('No chat front-end configured. Run npm run setup to set up Slack (SLACK_BOT_TOKEN + SLACK_APP_TOKEN) or Telegram (TELEGRAM_BOT_TOKEN).');
    } else {
      logger.error({ agentId: AGENT_ID }, `Configuration for agent "${AGENT_ID}" is broken: bot token not set. Check .env or re-run npm run agent:create.`);
    }
    process.exit(1);
  }

  acquireLock();

  try {
    initDatabase();
  } catch (err: any) {
    logger.error('Database initialization failed: %s', err?.message || err);
    if (err?.message?.includes('DB_ENCRYPTION_KEY')) {
      logger.error('Fix: add DB_ENCRYPTION_KEY to .env. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    process.exit(1);
  }
  logger.info('Database ready');
  seedBootstrapPairings();

  // Initialize security (kill phrase, audit)
  initSecurity({
    killPhrase: EMERGENCY_KILL_PHRASE || undefined,
  });
  setAuditCallback((entry) => {
    // The single mapping point from the audit() choke point to the writer.
    // Forward every optional captured field (Phase 5, D-01) — do not add a
    // second writer.
    insertAuditLog({
      agentId: entry.agentId,
      chatId: entry.chatId,
      action: entry.action,
      detail: entry.detail,
      blocked: entry.blocked,
      eventType: entry.eventType,
      tool: entry.tool,
      target: entry.target,
      project: entry.project,
      decision: entry.decision,
      decidedBy: entry.decidedBy,
      decidedAt: entry.decidedAt,
      result: entry.result,
      durationMs: entry.durationMs,
      model: entry.model,
      sessionId: entry.sessionId,
    });
  });

  initOrchestrator();

  // Decay and consolidation run ONLY in the main process to prevent
  // multi-process over-decay (5x decay on simultaneous restart) and
  // duplicate consolidation records from overlapping memory batches.
  if (AGENT_ID === 'main') {
    runDecaySweep();
    cleanupOldMissionTasks(7);
    setInterval(() => { runDecaySweep(); cleanupOldMissionTasks(7); }, 24 * 60 * 60 * 1000);

    // One-time bundled→mutable avatar migration. After this lands, any
    // previously user-uploaded main avatar that we wrote into the
    // bundled namespace gets copied into STORE_DIR/avatars/main.png so
    // the new resolver serves it as the mutable source-of-truth.
    runWarroomAvatarMigration();

    // Memory consolidation: find patterns across recent memories every 30 minutes
    if (PRIMARY_CHAT_ID && GOOGLE_API_KEY) {
      // Delay first consolidation 2 minutes after startup to let things settle
      setTimeout(() => {
        void runConsolidation(PRIMARY_CHAT_ID).catch((err) =>
          logger.error({ err }, 'Initial consolidation failed'),
        );
      }, 2 * 60 * 1000);
      setInterval(() => {
        void runConsolidation(PRIMARY_CHAT_ID).catch((err) =>
          logger.error({ err }, 'Periodic consolidation failed'),
        );
      }, 30 * 60 * 1000);
      logger.info('Memory consolidation enabled (every 30 min)');
    }
  } else {
    logger.info({ agentId: AGENT_ID }, 'Skipping decay/consolidation (main process owns these)');
  }

  cleanupOldUploads();

  // A sub-agent (--agent) wired to the Slack bot token posts cron/proactive
  // output to Slack via a send-only Web API client — NO Socket Mode listener,
  // so it never double-handles events with the main process (Phase 07 aos).
  // Telegram-backed sub-agents (their own *_BOT_TOKEN) keep the Telegram path.
  // True when this sub-agent's resolved bot token IS the main Slack bot token
  // (i.e. its config sets telegram_bot_token_env: SLACK_BOT_TOKEN). activeBotToken
  // is the agent's own token after setAgentOverrides; comparing to SLACK_BOT_TOKEN
  // keeps this in main()'s scope (agentConfig is only bound in the pre-main bootstrap).
  const useSlackSender = !useSlack && TRANSPORT === 'slack' && !!SLACK_BOT_TOKEN && activeBotToken === SLACK_BOT_TOKEN;
  const bot = (useSlack || useSlackSender) ? undefined : createBot();
  const slack: SlackBot | undefined = useSlack ? createSlackBot() : undefined;
  const slackSender: SlackSender | undefined = useSlackSender ? createSlackSender() : undefined;
  let discord: DiscordBot | undefined;
  if (AGENT_ID === 'main' && DISCORD_BOT_TOKEN) {
    try {
      discord = createDiscordBot(DISCORD_BOT_TOKEN);
    } catch (err) {
      logger.error({ err }, 'Discord bot failed to construct. Dashboard will still start.');
    }
  }

  // Unified proactive notifier — routes scheduler / OAuth-health / War Room
  // messages to whichever transport is active.
  const notifyUser = async (text: string): Promise<void> => {
    if (slack) { await slack.postToUser(text); return; }
    if (slackSender) { await slackSender.postToUser(text); return; }
    if (bot) {
      for (const chunk of splitMessage(text)) {
        await bot.api.sendMessage(ALLOWED_CHAT_ID, chunk, { parse_mode: 'HTML' }).catch((err) =>
          logger.error({ err }, 'Failed to send proactive message'),
        );
      }
    }
  };

  // Dashboard relays its replies to whichever transport is active.
  const dashboardRelay = slack
    ? (text: string) => slack.postToUser(text)
    : bot
      ? async (text: string) => {
          const { formatForTelegram, splitMessage: splitTg } = await import('./bot.js');
          for (const part of splitTg(formatForTelegram(text))) {
            await bot.api.sendMessage(parseInt(ALLOWED_CHAT_ID), part, { parse_mode: 'HTML' });
          }
        }
      : undefined;

  // Dashboard only runs in the main bot process
  if (AGENT_ID === 'main') {
    startDashboard(dashboardRelay);

    // War Room voice server (auto-start if enabled, with auto-respawn)
    if (WARROOM_ENABLED) {
      const { spawn } = await import('child_process');
      // The venv is operator-created state, so in a packaged .app it lives under
      // the writable data dir, not the read-only bundle PROJECT_ROOT points at.
      // Check the data dir first, then the repo layout (dev: both are equal).
      const venv = resolveVenvPython([DATA_DIR, PROJECT_ROOT], 'warroom');
      const venvPython = venv.python;
      // server.py ships with the code, so it is always under PROJECT_ROOT.
      const serverScript = path.join(PROJECT_ROOT, 'warroom', 'server.py');
      const requirements = path.join(PROJECT_ROOT, 'warroom', 'requirements.txt');

      // Write agent roster so the Python voice stack can discover agents.
      // Shared helper so agent-create can call it too on new/delete.
      refreshWarRoomRoster();

      if (venv.found && fs.existsSync(serverScript)) {
        // Pre-flight: verify Python dependencies are actually installed
        const { spawnSync } = await import('child_process');
        const depCheck = spawnSync(venvPython, ['-c', 'import pipecat'], { stdio: 'pipe', timeout: 10000 });
        if (depCheck.status !== 0) {
          const msg = 'War Room Python dependencies not installed. Run:\n\n'
            + `"${venvPython}" -m pip install -r "${requirements}"\n\n`
            + 'Then restart the bot.';
          logger.error(msg);
          void notifyUser(`War Room could not start.\n\n${msg}`).catch(() => {});
        } else {
        // Dedicated log file for the warroom subprocess
        const warroomLogPath = '/tmp/warroom-debug.log';
        let warroomLogFd: number | null = null;
        try {
          warroomLogFd = fs.openSync(warroomLogPath, 'a');
        } catch (err) {
          logger.warn({ err, warroomLogPath }, 'Could not open warroom log');
        }

        const MAX_CRASH_RESPAWNS = 3;
        // Time a process must stay alive without crashing before we treat
        // its crash counter as "recovered" and reset it. The python server
        // prints "ready" before it actually binds the WS transport, so a
        // bind-time failure could print ready then crash in the same
        // second. Resetting on first stdout chunk let that loop forever.
        const STABLE_UPTIME_MS = 20_000;
        let respawnAttempts = 0;
        let shuttingDown = false;
        let currentProc: ReturnType<typeof spawn> | null = null;

        const spawnWarroom = (): void => {
          if (shuttingDown) return;
          const proc = spawn(venvPython, [serverScript], {
            cwd: PROJECT_ROOT,
            // readEnvFile deliberately keeps secrets out of process.env, so the
            // Python child cannot inherit its API keys — hand it the .env path
            // instead. Without this it looks for PROJECT_ROOT/.env, which does
            // not exist in a packaged .app, and exits on missing keys.
            env: {
              ...process.env,
              WARROOM_PORT: String(WARROOM_PORT),
              CLAUDECLAW_ENV_FILE: ENV_FILE,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          currentProc = proc;

          // Schedule the crash-counter reset based on *uptime*, not the
          // readiness line. Cleared in the exit handler if the process
          // dies before reaching STABLE_UPTIME_MS.
          const stableResetHandle = setTimeout(() => {
            respawnAttempts = 0;
          }, STABLE_UPTIME_MS);

          proc.stdout.once('data', (data: Buffer) => {
            try {
              const info = JSON.parse(data.toString().trim());
              logger.info({ port: WARROOM_PORT, ws_url: info.ws_url, pid: proc.pid }, 'War Room server started');
            } catch {
              logger.info({ port: WARROOM_PORT, pid: proc.pid }, 'War Room server started');
            }
          });

          // Forward stdout+stderr into the dedicated log file.
          if (warroomLogFd !== null) {
            const write = (buf: Buffer) => { try { fs.writeSync(warroomLogFd!, buf); } catch { /* ok */ } };
            proc.stdout.on('data', write);
            proc.stderr.on('data', write);
          }

          proc.on('exit', (code, signal) => {
            clearTimeout(stableResetHandle);
            if (shuttingDown) return;
            const wasIntentional = signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGINT';
            logger.warn({ code, signal, pid: proc.pid, intentional: wasIntentional }, 'War Room server exited');
            let delayMs: number;
            if (wasIntentional) {
              delayMs = 300;
              respawnAttempts = 0;
            } else {
              respawnAttempts += 1;
              if (respawnAttempts > MAX_CRASH_RESPAWNS) {
                logger.error(`War Room crashed ${MAX_CRASH_RESPAWNS} times. Giving up. Check /tmp/warroom-debug.log for errors.`);
                void notifyUser(`War Room crashed ${MAX_CRASH_RESPAWNS} times and has been disabled.\n\nCheck /tmp/warroom-debug.log, fix the issue, and restart the bot.`).catch(() => {});
                return;
              }
              delayMs = Math.min(30000, 500 * 2 ** Math.min(respawnAttempts, 6));
            }
            logger.info({ delayMs, attempt: respawnAttempts }, 'Respawning War Room server');
            setTimeout(spawnWarroom, delayMs);
          });
        };

        spawnWarroom();

        // Clean up on main process exit.
        const shutdownWarroom = () => {
          shuttingDown = true;
          try { currentProc?.kill(); } catch { /* ok */ }
          if (warroomLogFd !== null) { try { fs.closeSync(warroomLogFd); } catch { /* ok */ } }
        };
        process.on('exit', shutdownWarroom);
        process.on('SIGTERM', shutdownWarroom);
        process.on('SIGINT', shutdownWarroom);
        } // end dep check else
      } else {
        // Name the resolved paths: in a packaged .app the venv belongs under the
        // data dir, so a repo-relative recipe would be created in the wrong place.
        const hint = !venv.found
          ? 'Python venv not found. Looked in:\n'
            + venv.candidates.map((dir) => `  ${dir}`).join('\n')
            + '\n\nRun:\n\n'
            + `python3 -m venv "${venv.venvDir}"\n`
            + `"${venvPython}" -m pip install -r "${requirements}"`
          : `${serverScript} not found. Make sure the warroom/ directory exists.`;
        logger.warn('War Room enabled but cannot start: %s', hint);
        void notifyUser(`War Room is enabled but could not start.\n\n${hint}`).catch(() => {});
      }
    }
  }

  const hasDestination = useSlack ? !!ALLOWED_SLACK_USER_ID : !!ALLOWED_CHAT_ID;
  if (hasDestination) {
    // aos service only: project agentic-os cron/jobs/*.md into scheduled_tasks
    // rows BEFORE the scheduler's first tick so due aos jobs exist to fire
    // (SCH-02). Other agents (main, comms, ...) never sync — no fleet change.
    if (AGENT_ID === 'aos') {
      syncAosCronJobs();
    }

    // The notifier handles chunking and transport-specific formatting. On the
    // full Slack transport we also hand the scheduler a rich task-result poster
    // so mission output ships as a thread-anchored Block Kit message the operator
    // can reply under to send feedback (task output routing).
    initScheduler(async (text) => { await notifyUser(text); }, AGENT_ID, slack ? slack.postTaskResult : undefined);

    // Proactive OAuth health monitoring — alerts before the Claude CLI token
    // expires. OPT-IN: users were getting spammed with "Expiring soon" alerts
    // on fresh installs, and people who don't monitor their phone can't re-auth
    // in time anyway. Enable via OAUTH_HEALTH_ENABLED=true in .env.
    const oauthHealthEnv = (await import('./env.js')).readEnvFile(['OAUTH_HEALTH_ENABLED']);
    if ((oauthHealthEnv.OAUTH_HEALTH_ENABLED || '').trim().toLowerCase() === 'true') {
      initOAuthHealthCheck(async (text) => { await notifyUser(text); });
    } else {
      logger.info('OAuth health check disabled (set OAUTH_HEALTH_ENABLED=true in .env to enable)');
    }
  } else {
    logger.warn('No message destination set (ALLOWED_CHAT_ID / ALLOWED_SLACK_USER_ID) — scheduler disabled');
  }

  const shutdown = async () => {
    logger.info('Shutting down...');
    if (slack) setSlackConnected(false); else setTelegramConnected(false);
    releaseLock();
    if (discord) await discord.stop();
    if (slack) await slack.stop();
    else if (bot) await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  logger.info({ agentId: AGENT_ID, transport: slack ? 'slack' : slackSender ? 'slack-send-only' : bot ? 'telegram' : 'none', discord: !!discord }, 'Starting ClaudeClaw...');

  // Discord is additive and must start BEFORE Telegram's blocking poll.
  if (discord) {
    try {
      const { botUserId, botName } = await discord.start();
      logger.info({ botUserId, botName }, 'ClaudeClaw (Discord) is running');
      console.log(`  Discord online${botName ? `: @${botName}` : ''}`);
    } catch (err) {
      logger.error({ err }, 'Discord failed to start. Other transports remain available.');
    }
  }

  if (slack) {
    try {
      const { botUserId, botName } = await slack.start();
      setSlackConnected(true);
      setBotInfo(botName, botName);
      logger.info({ botUserId, botName }, 'ClaudeClaw (Slack) is running');
      console.log(`\n  ClaudeClaw online on Slack${botName ? `: @${botName}` : ''}`);
      if (!ALLOWED_SLACK_USER_ID) {
        console.log(`  First DM becomes the operator. Later senders get a pairing code (/pair CODE).`);
      }
      console.log();
    } catch (err) {
      setSlackConnected(false);
      logger.error({ err }, 'Slack Socket Mode failed to start. Dashboard and local services remain available.');
    }
  } else if (bot) {
    // Clear any existing webhook so polling works cleanly (e.g., if token was
    // previously used with a webhook-based bot or another ClaudeClaw instance).
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch (err) {
      logger.warn({ err }, 'Could not clear webhook (non-fatal)');
    }

    try {
      await bot.start({
        onStart: (botInfo) => {
          setTelegramConnected(true);
          setBotInfo(botInfo.username ?? '', botInfo.first_name ?? 'ClaudeClaw');
          logger.info({ username: botInfo.username }, 'ClaudeClaw is running');
          if (AGENT_ID === 'main') {
            console.log(`\n  ClaudeClaw online: @${botInfo.username}`);
            if (!ALLOWED_CHAT_ID) {
              console.log(`  First private chat becomes the operator. Later senders get a pairing code (/pair CODE).`);
            }
            console.log();
          } else {
            console.log(`\n  ClaudeClaw agent [${AGENT_ID}] online: @${botInfo.username}\n`);
          }
        },
      });
    } catch (err) {
      setTelegramConnected(false);
      logger.error(
        { err },
        'Telegram polling failed to start. Dashboard and local services remain available.',
      );
    }
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error');
  releaseLock();
  process.exit(1);
});
