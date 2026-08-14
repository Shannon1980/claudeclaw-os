// Token + chatId come from the URL query string (set by the Telegram deep
// link or by a saved bookmark). We persist both to sessionStorage on first
// load so subsequent navigations keep working without rewriting the URL.
// We never use localStorage: dashboardToken is sensitive, and storing it
// across browser sessions would enlarge its blast radius.

import { networkErrorMessage } from './network';

const url = new URL(window.location.href);

let cachedToken = url.searchParams.get('token') || '';
if (cachedToken) {
  try { sessionStorage.setItem('claudeclaw.token', cachedToken); } catch {}
} else {
  try { cachedToken = sessionStorage.getItem('claudeclaw.token') || ''; } catch {}
}

let cachedChatId = url.searchParams.get('chatId') || '';
if (cachedChatId) {
  try { sessionStorage.setItem('claudeclaw.chatId', cachedChatId); } catch {}
} else {
  try { cachedChatId = sessionStorage.getItem('claudeclaw.chatId') || ''; } catch {}
}

export const dashboardToken = cachedToken;
export const chatId = cachedChatId;

function withToken(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(dashboardToken)}`;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(withToken(path), init);
  } catch (err) {
    throw new ApiError(0, null, networkErrorMessage(err));
  }
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await send(path, { method: 'GET' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await send(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

/** Multipart upload. The browser sets the multipart boundary, so no
 *  explicit content-type header here. */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await send(path, { method: 'POST', body: form });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = (errBody as any)?.error || `POST ${path} failed: ${res.status}`;
    throw new ApiError(res.status, errBody, msg);
  }
  return res.json();
}

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await send(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `PATCH ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await send(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `PUT ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await send(path, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function tokenizedSseUrl(path: string): string {
  return withToken(path);
}

// Vite dev runs on :5174 (see vite.config.ts) and proxies /api/* and /warroom/text to the
// backend on :3141. The legacy voice room at /warroom?mode=voice can't
// be proxied (it shares a path prefix with the v2 SPA route), so links
// that go to legacy pages must point at the backend origin in dev.
const BACKEND_ORIGIN = (import.meta as any).env?.DEV
  ? ((import.meta as any).env?.VITE_BACKEND_ORIGIN || 'http://localhost:3141')
  : '';

export function legacyUrl(path: string): string {
  return BACKEND_ORIGIN + path;
}
