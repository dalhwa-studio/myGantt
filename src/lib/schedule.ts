import type { Dependency, ID, Task } from '../types';
import { addWorking, fromDay, nextWorking, toDay, workingDaysBetween, type Day, type WorkCal } from './date';

export interface Eff {
  start: Day | null;
  end: Day | null;
  progress: number;
  hasChildren: boolean;
}

export const rootKey = (projectId: ID) => `p:${projectId}`;
export const parentKey = (t: Pick<Task, 'parentId' | 'projectId'>) => t.parentId ?? rootKey(t.projectId);

/** children keyed by parent id (or `p:<projectId>` for roots), sorted by order */
export function buildTree(tasks: Task[]): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = parentKey(t);
    let arr = m.get(k);
    if (!arr) m.set(k, (arr = []));
    arr.push(t);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.order - b.order);
  return m;
}

export function descendants(tree: Map<string, Task[]>, id: ID): Task[] {
  const out: Task[] = [];
  const stack = [...(tree.get(id) ?? [])];
  while (stack.length) {
    const t = stack.pop()!;
    out.push(t);
    stack.push(...(tree.get(t.id) ?? []));
  }
  return out;
}

export function ancestors(byId: Map<ID, Task>, id: ID): ID[] {
  const out: ID[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  let guard = 0;
  while (cur && guard++ < 1000) {
    out.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

/** Roll up dates & progress from children to parents. */
export function computeEffective(tasks: Task[], tree = buildTree(tasks)): Map<ID, Eff> {
  const res = new Map<ID, Eff>();
  const visit = (t: Task): Eff => {
    const cached = res.get(t.id);
    if (cached) return cached;
    const kids = tree.get(t.id) ?? [];
    let e: Eff;
    if (!kids.length) {
      const start = t.start ? toDay(t.start) : null;
      let end = t.end ? toDay(t.end) : start;
      if (t.type === 'milestone') end = start;
      if (start != null && end != null && end < start) end = start;
      const progress = t.status === 'done' ? 100 : t.progress;
      e = { start, end, progress, hasChildren: false };
    } else {
      let s: Day | null = null;
      let en: Day | null = null;
      let wsum = 0;
      let psum = 0;
      for (const k of kids) {
        const ke = visit(k);
        if (ke.start != null && ke.end != null) {
          s = s == null ? ke.start : Math.min(s, ke.start);
          en = en == null ? ke.end : Math.max(en, ke.end);
          const w = ke.end - ke.start + 1;
          wsum += w;
          psum += ke.progress * w;
        } else {
          wsum += 1;
          psum += ke.progress;
        }
      }
      e = { start: s, end: en, progress: wsum ? Math.round(psum / wsum) : 0, hasChildren: true };
    }
    res.set(t.id, e);
    return e;
  };
  for (const t of tasks) visit(t);
  return res;
}

/** Shift a task (or all descendants of a parent) by delta calendar days. Mutates `map`. */
export function shiftTask(
  map: Map<ID, Task>,
  tree: Map<string, Task[]>,
  id: ID,
  delta: number,
  cal?: WorkCal,
) {
  if (!delta) return;
  const t = map.get(id);
  if (!t) return;
  const kids = tree.get(id) ?? [];
  const targets = kids.length ? descendants(tree, id).filter((d) => !(tree.get(d.id) ?? []).length) : [t];
  for (const tt of targets) {
    const cur = map.get(tt.id)!;
    if (!cur.start) continue;
    const s = toDay(cur.start);
    const e = cur.end ? toDay(cur.end) : s;
    let ns = s + delta;
    let ne = e + delta;
    if (cal?.enabled) {
      const dur = Math.max(1, workingDaysBetween(cal, s, e));
      ns = nextWorking(cal, ns);
      ne = cur.type === 'milestone' ? ns : addWorking(cal, ns, dur);
    }
    map.set(tt.id, { ...cur, start: fromDay(ns), end: fromDay(ne) });
  }
}

/** Earliest allowed shift (>0 means successor must move forward). */
function requiredDelta(dep: Dependency, p: Eff, s: Eff, cal: WorkCal): number {
  if (p.start == null || p.end == null || s.start == null || s.end == null) return 0;
  switch (dep.type) {
    case 'FS': {
      const req = cal.enabled ? nextWorking(cal, p.end + 1 + dep.lag) : p.end + 1 + dep.lag;
      return req - s.start;
    }
    case 'SS': {
      const req = cal.enabled ? nextWorking(cal, p.start + dep.lag) : p.start + dep.lag;
      return req - s.start;
    }
    case 'FF':
      return p.end + dep.lag - s.end;
    case 'SF':
      return p.start + dep.lag - s.end;
  }
}

/**
 * Push successors forward so that all dependency constraints are satisfied.
 * Only moves tasks forward (never pulls them earlier).
 */
export function autoSchedule(tasks: Task[], deps: Dependency[], seeds: ID[], cal: WorkCal): Task[] {
  const map = new Map(tasks.map((t) => [t.id, t]));
  const tree = buildTree(tasks);
  const out = new Map<ID, Dependency[]>();
  for (const d of deps) {
    let arr = out.get(d.from);
    if (!arr) out.set(d.from, (arr = []));
    arr.push(d);
  }
  const expand = (id: ID) => [id, ...ancestors(map, id), ...descendants(tree, id).map((d) => d.id)];
  const queue: ID[] = [];
  for (const s of seeds) queue.push(...expand(s));
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const id = queue.shift()!;
    const ds = out.get(id);
    if (!ds) continue;
    const eff = computeEffective([...map.values()], buildTree([...map.values()]));
    for (const dep of ds) {
      const p = eff.get(dep.from);
      const s = eff.get(dep.to);
      if (!p || !s) continue;
      const delta = requiredDelta(dep, p, s, cal);
      if (delta > 0) {
        shiftTask(map, buildTree([...map.values()]), dep.to, delta, cal);
        queue.push(...expand(dep.to));
      }
    }
  }
  return tasks.map((t) => map.get(t.id)!);
}

/** Would adding from->to create a cycle? */
export function createsCycle(deps: Dependency[], from: ID, to: ID): boolean {
  if (from === to) return true;
  const adj = new Map<ID, ID[]>();
  for (const d of deps) {
    let a = adj.get(d.from);
    if (!a) adj.set(d.from, (a = []));
    a.push(d.to);
  }
  const seen = new Set<ID>();
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(adj.get(n) ?? []));
  }
  return false;
}

/** Critical path: tasks with zero (or negative) total slack. */
export function criticalTasks(tasks: Task[], deps: Dependency[], eff: Map<ID, Eff>): Set<ID> {
  const dated = tasks.filter((t) => {
    const e = eff.get(t.id);
    return e && e.start != null && e.end != null;
  });
  const ids = new Set(dated.map((t) => t.id));
  const projEnd = new Map<ID, Day>();
  for (const t of dated) {
    const e = eff.get(t.id)!;
    if (e.hasChildren) continue;
    projEnd.set(t.projectId, Math.max(projEnd.get(t.projectId) ?? -Infinity, e.end!));
  }
  const ds = deps.filter((d) => ids.has(d.from) && ids.has(d.to));
  const outgoing = new Map<ID, Dependency[]>();
  const indeg = new Map<ID, number>();
  for (const id of ids) indeg.set(id, 0);
  for (const d of ds) {
    let a = outgoing.get(d.from);
    if (!a) outgoing.set(d.from, (a = []));
    a.push(d);
    indeg.set(d.to, (indeg.get(d.to) ?? 0) + 1);
  }
  // topological order
  const order: ID[] = [];
  const q = [...ids].filter((id) => indeg.get(id) === 0);
  while (q.length) {
    const n = q.shift()!;
    order.push(n);
    for (const d of outgoing.get(n) ?? []) {
      indeg.set(d.to, indeg.get(d.to)! - 1);
      if (indeg.get(d.to) === 0) q.push(d.to);
    }
  }
  const byId = new Map(dated.map((t) => [t.id, t]));
  const lf = new Map<ID, number>();
  const crit = new Set<ID>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = byId.get(id)!;
    const e = eff.get(id)!;
    const dur = e.end! - e.start! + 1;
    let latest = projEnd.get(t.projectId) ?? e.end!;
    for (const d of outgoing.get(id) ?? []) {
      const vLF = lf.get(d.to);
      if (vLF == null) continue;
      const ve = eff.get(d.to)!;
      const vLS = vLF - (ve.end! - ve.start!);
      let c: number;
      switch (d.type) {
        case 'FS':
          c = vLS - 1 - d.lag;
          break;
        case 'SS':
          c = vLS - d.lag + dur - 1;
          break;
        case 'FF':
          c = vLF - d.lag;
          break;
        case 'SF':
          c = vLF - d.lag + dur - 1;
          break;
      }
      latest = Math.min(latest, c);
    }
    lf.set(id, latest);
    if (!e.hasChildren && latest - e.end! <= 0) crit.add(id);
  }
  return crit;
}
