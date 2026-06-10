/** Canonical Claude model list for dashboard, bots, and agent config. */

export interface ClaudeModelOption {
  id: string;
  label: string;
}

export const CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-opus-4-5', label: 'Opus 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

export const VALID_CLAUDE_MODEL_IDS = CLAUDE_MODELS.map((m) => m.id);

export function isValidClaudeModel(model: string): boolean {
  return VALID_CLAUDE_MODEL_IDS.includes(model);
}

/** Short names accepted by /model in Telegram and Slack. */
export const CLAUDE_MODEL_CHAT_ALIASES: Record<string, string> = {
  fable: 'claude-fable-5',
  opus: 'claude-opus-4-8',
  'opus-4-8': 'claude-opus-4-8',
  'opus-4-7': 'claude-opus-4-7',
  'opus-4-6': 'claude-opus-4-6',
  'opus-4-5': 'claude-opus-4-5',
  sonnet: 'claude-sonnet-4-6',
  'sonnet-4-6': 'claude-sonnet-4-6',
  'sonnet-4-5': 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5',
};

export function resolveClaudeModelAlias(alias: string): string | undefined {
  return CLAUDE_MODEL_CHAT_ALIASES[alias.toLowerCase()];
}

const LABEL_BY_ID = new Map(CLAUDE_MODELS.map((m) => [m.id, m.label]));

export function claudeModelLabel(modelId: string): string {
  return LABEL_BY_ID.get(modelId) ?? modelId.replace(/^claude-/, '');
}
