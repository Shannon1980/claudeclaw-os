import pino from 'pino';

const TELEGRAM_BOT_TOKEN_RE = /(?<![A-Za-z0-9_-])(?:bot)?\d{6,}:[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g;

function redactLogText(text: string): string {
  return text.replace(TELEGRAM_BOT_TOKEN_RE, '[REDACTED_TELEGRAM_BOT_TOKEN]');
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const errorWithCode = err as Error & { code?: unknown };
    return {
      type: err.constructor.name,
      message: redactLogText(err.message),
      stack: err.stack ? redactLogText(err.stack) : undefined,
      name: err.name,
      code: errorWithCode.code,
    };
  }
  if (typeof err === 'string') {
    return redactLogText(err);
  }
  return err;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    err: serializeError,
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
