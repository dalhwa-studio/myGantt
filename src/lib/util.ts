import type { Priority, Status } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const PALETTE = [
  '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b',
];

export const STATUS_LABEL: Record<Status, string> = {
  todo: '할 일',
  inprogress: '진행 중',
  review: '검토',
  done: '완료',
};
export const STATUS_COLOR: Record<Status, string> = {
  todo: '#94a3b8',
  inprogress: '#0ea5e9',
  review: '#f59e0b',
  done: '#10b981',
};
export const STATUSES: Status[] = ['todo', 'inprogress', 'review', 'done'];

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: '없음',
  low: '낮음',
  medium: '보통',
  high: '높음',
};

export function initials(name: string) {
  const n = name.trim();
  if (!n) return '?';
  const parts = n.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return /[a-z]/i.test(n[0]) ? n.slice(0, 2).toUpperCase() : n.slice(0, 1);
}

export function download(filename: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('no file'));
      f.text().then(resolve, reject);
    };
    input.click();
  });
}

/* ---------------- CSV ---------------- */

export function toCSV(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? '' : String(c);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
