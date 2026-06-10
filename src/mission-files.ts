import fs from 'fs';
import path from 'path';

import { extractFileMarkers } from './format.js';
import type { MissionTask } from './db.js';

export interface MissionTaskFile {
  path: string;
  name: string;
  kind: 'document' | 'image' | 'video' | 'photo' | 'other';
  direction: 'input' | 'output';
  caption?: string;
  exists: boolean;
  is_url: boolean;
  task_id: string;
  task_title: string;
}

const INPUT_LINE =
  /^-\s+(document|image|video):\s+(.+?)\s+[—-]\s+saved at\s+(.+)$/gm;

function fileKindFromExt(ext: string, fallback: string): MissionTaskFile['kind'] {
  const e = ext.toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic'].includes(e)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(e)) return 'video';
  if (['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.md', '.txt'].includes(e)) {
    return 'document';
  }
  if (fallback === 'image' || fallback === 'photo') return fallback === 'photo' ? 'photo' : 'image';
  if (fallback === 'video') return 'video';
  if (fallback === 'document') return 'document';
  return 'other';
}

function describePath(
  filePath: string,
  nameHint: string,
  kindHint: string,
  direction: 'input' | 'output',
  task: Pick<MissionTask, 'id' | 'title'>,
  caption?: string,
): MissionTaskFile {
  const isUrl = /^https?:\/\//i.test(filePath);
  const exists = isUrl ? true : fs.existsSync(filePath);
  const name = nameHint || path.basename(filePath);
  const kind = fileKindFromExt(path.extname(name), kindHint);
  return {
    path: filePath,
    name,
    kind,
    direction,
    caption,
    exists,
    is_url: isUrl,
    task_id: task.id,
    task_title: task.title,
  };
}

/** Parse dashboard-upload attachments embedded in a mission task prompt. */
export function parseTaskInputFiles(task: Pick<MissionTask, 'id' | 'title' | 'prompt'>): MissionTaskFile[] {
  const out: MissionTaskFile[] = [];
  for (const match of task.prompt.matchAll(INPUT_LINE)) {
    const [, kind, name, filePath] = match;
    out.push(describePath(filePath.trim(), name.trim(), kind, 'input', task));
  }
  return out;
}

/** Parse [SEND_FILE:…] / [SEND_PHOTO:…] markers from a completed task result. */
export function parseTaskOutputFiles(task: Pick<MissionTask, 'id' | 'title' | 'result'>): MissionTaskFile[] {
  if (!task.result) return [];
  const { files } = extractFileMarkers(task.result);
  return files.map((f) =>
    describePath(
      f.filePath,
      path.basename(f.filePath.split('?')[0] || f.filePath),
      f.type === 'photo' ? 'photo' : 'document',
      'output',
      task,
      f.caption,
    ),
  );
}

export function collectTaskFiles(task: Pick<MissionTask, 'id' | 'title' | 'prompt' | 'result'>): {
  input: MissionTaskFile[];
  output: MissionTaskFile[];
  result_display: string | null;
} {
  const input = parseTaskInputFiles(task);
  const output = parseTaskOutputFiles(task);
  const result_display = task.result ? extractFileMarkers(task.result).text || null : null;
  return { input, output, result_display };
}

/** Flatten all files across project tasks (deduped by path + direction + task). */
export function collectProjectFiles(tasks: MissionTask[]): MissionTaskFile[] {
  const seen = new Set<string>();
  const out: MissionTaskFile[] = [];
  for (const task of tasks) {
    const { input, output } = collectTaskFiles(task);
    for (const f of [...input, ...output]) {
      const key = `${f.direction}:${f.path}:${f.task_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

/** Paths a project is allowed to download (local files referenced by its tasks). */
export function allowedProjectDownloadPaths(tasks: MissionTask[]): string[] {
  return collectProjectFiles(tasks)
    .filter((f) => !f.is_url && f.exists)
    .map((f) => path.resolve(f.path));
}
