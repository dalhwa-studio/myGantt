import { useMemo } from 'react';
import { useStore } from '../store';
import type { Filters, ID, Project, Task, Zoom } from '../types';
import { buildTree, computeEffective, criticalTasks, rootKey, type Eff } from './schedule';
import {
  addMonths, dayOf, makeCal, startOfMonth, startOfQuarter, startOfWeek, startOfYear, todayDay, ymd, type Day,
} from './date';

export const ROW_H = 36;

export type Row =
  | { kind: 'project'; key: string; project: Project; depth: 0 }
  | { kind: 'task'; key: string; task: Task; depth: number; hasChildren: boolean };

export function useCal() {
  const s = useStore((s) => s.settings);
  return useMemo(() => makeCal(s.workingDays, s.holidays, s.workingDaysOnly), [s.workingDays, s.holidays, s.workingDaysOnly]);
}

export function useTree() {
  const tasks = useStore((s) => s.tasks);
  return useMemo(() => {
    const tree = buildTree(tasks);
    const eff = computeEffective(tasks, tree);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return { tree, eff, byId };
  }, [tasks]);
}

export function useCritical(eff: Map<ID, Eff>) {
  const tasks = useStore((s) => s.tasks);
  const deps = useStore((s) => s.deps);
  const on = useStore((s) => s.settings.showCritical);
  return useMemo(() => (on ? criticalTasks(tasks, deps, eff) : new Set<ID>()), [on, tasks, deps, eff]);
}

export function filtersActive(f: Filters) {
  return !!f.search.trim() || f.assignee !== 'all' || f.status !== 'all' || f.hideDone;
}

export function matchesFilter(t: Task, f: Filters) {
  if (f.search.trim() && !t.name.toLowerCase().includes(f.search.trim().toLowerCase())) return false;
  if (f.assignee === 'none' && t.assignees.length) return false;
  if (f.assignee !== 'all' && f.assignee !== 'none' && !t.assignees.includes(f.assignee)) return false;
  if (f.status !== 'all' && t.status !== f.status) return false;
  if (f.hideDone && t.status === 'done') return false;
  return true;
}

export function useRows(): Row[] {
  const projects = useStore((s) => s.projects);
  const filters = useStore((s) => s.filters);
  const { tree } = useTree();
  return useMemo(() => {
    const active = filtersActive(filters);
    const visibleCache = new Map<ID, boolean>();
    const visible = (t: Task): boolean => {
      if (!active) return true;
      const c = visibleCache.get(t.id);
      if (c != null) return c;
      const v = matchesFilter(t, filters) || (tree.get(t.id) ?? []).some(visible);
      visibleCache.set(t.id, v);
      return v;
    };
    const rows: Row[] = [];
    const walk = (key: string, depth: number) => {
      for (const t of tree.get(key) ?? []) {
        if (!visible(t)) continue;
        const kids = tree.get(t.id) ?? [];
        rows.push({ kind: 'task', key: t.id, task: t, depth, hasChildren: kids.length > 0 });
        if (kids.length && !t.collapsed) walk(t.id, depth + 1);
      }
    };
    for (const p of [...projects].sort((a, b) => a.order - b.order)) {
      if (!p.visible) continue;
      rows.push({ kind: 'project', key: 'p:' + p.id, project: p, depth: 0 });
      if (!p.collapsed) walk(rootKey(p.id), 1);
    }
    return rows;
  }, [projects, filters, tree]);
}

/* ---------------- Timeline scale ---------------- */

export const ZOOM_DW: Record<Zoom, number> = { day: 36, week: 18, month: 5, quarter: 2.2, year: 0.9 };
export const ZOOM_LABEL: Record<Zoom, string> = { day: '일', week: '주', month: '월', quarter: '분기', year: '년' };

export interface Scale {
  start: Day;
  end: Day;
  dw: number;
  width: number;
  zoom: Zoom;
}

export function useScale(): Scale {
  const zoom = useStore((s) => s.settings.zoom);
  const { eff } = useTree();
  return useMemo(() => {
    const today = todayDay();
    let min = today - 30;
    let max = today + 120;
    for (const e of eff.values()) {
      if (e.start != null) min = Math.min(min, e.start - 21);
      if (e.end != null) max = Math.max(max, e.end + 60);
    }
    const dw = ZOOM_DW[zoom];
    if (zoom === 'month' || zoom === 'quarter' || zoom === 'year') {
      min = startOfYear(min);
      max = Math.max(max, min + 3 * 365);
      max = dayOf(ymd(max).y + 1, 0, 1) - 1;
    } else {
      min = startOfMonth(min);
      max = addMonths(startOfMonth(max), 1) - 1;
    }
    return { start: min, end: max, dw, width: (max - min + 1) * dw, zoom };
  }, [zoom, eff]);
}

export type UnitKind = 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface Unit {
  start: Day;
  end: Day;
  label: string;
}

function nextUnit(d: Day, kind: UnitKind): Day {
  switch (kind) {
    case 'day':
      return d + 1;
    case 'week':
      return d + 7;
    case 'month':
      return addMonths(d, 1);
    case 'quarter':
      return addMonths(d, 3);
    case 'year':
      return addMonths(d, 12);
  }
}
function firstUnit(d: Day, kind: UnitKind): Day {
  switch (kind) {
    case 'day':
      return d;
    case 'week':
      return startOfWeek(d);
    case 'month':
      return startOfMonth(d);
    case 'quarter':
      return startOfQuarter(d);
    case 'year':
      return startOfYear(d);
  }
}
function label(d: Day, kind: UnitKind, top: boolean): string {
  const { y, m, d: dd } = ymd(d);
  switch (kind) {
    case 'day':
      return String(dd);
    case 'week':
      return `${m + 1}/${dd}`;
    case 'month':
      return top ? `${y}년 ${m + 1}월` : `${m + 1}월`;
    case 'quarter':
      return top ? `${y} Q${Math.floor(m / 3) + 1}` : `Q${Math.floor(m / 3) + 1}`;
    case 'year':
      return `${y}년`;
  }
}

export function units(start: Day, end: Day, kind: UnitKind, top = false): Unit[] {
  const out: Unit[] = [];
  let d = firstUnit(start, kind);
  let guard = 0;
  while (d <= end && guard++ < 5000) {
    const n = nextUnit(d, kind);
    out.push({ start: Math.max(d, start), end: Math.min(n - 1, end), label: label(d, kind, top) });
    d = n;
  }
  return out;
}

export const TIERS: Record<Zoom, [UnitKind, UnitKind]> = {
  day: ['month', 'day'],
  week: ['month', 'week'],
  month: ['year', 'month'],
  quarter: ['year', 'quarter'],
  year: ['year', 'quarter'],
};
