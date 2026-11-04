import { toPng } from 'html-to-image';
import { useStore } from '../store';
import type { Data, DepType, ID, Status, Task } from '../types';
import { buildTree, computeEffective, rootKey } from './schedule';
import { fromDay } from './date';
import { PALETTE, download, parseCSV, toCSV, uid } from './util';
import { newTask } from './task';

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJSON() {
  const s = useStore.getState();
  const data: Data & { app: string; version: number } = {
    app: 'myGantt',
    version: 1,
    projects: s.projects,
    tasks: s.tasks,
    deps: s.deps,
    members: s.members,
    baselines: s.baselines,
  };
  download(`mygantt-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export function importJSON(text: string, mode: 'replace' | 'merge') {
  const d = JSON.parse(text) as Partial<Data>;
  if (!Array.isArray(d.tasks) || !Array.isArray(d.projects)) throw new Error('올바른 myGantt 파일이 아닙니다');
  if (mode === 'merge') {
    // re-id everything to avoid collisions
    const map = new Map<ID, ID>();
    const re = (id: ID) => {
      if (!map.has(id)) map.set(id, uid());
      return map.get(id)!;
    };
    d.projects = d.projects.map((p) => ({ ...p, id: re(p.id) }));
    d.tasks = d.tasks.map((t) => ({ ...t, id: re(t.id), projectId: re(t.projectId), parentId: t.parentId ? re(t.parentId) : null }));
    d.deps = (d.deps ?? []).map((x) => ({ ...x, id: uid(), from: re(x.from), to: re(x.to) }));
    d.baselines = [];
  }
  useStore.getState().importData(d, mode);
}

const HEADERS = ['ID', '프로젝트', '상위 ID', 'WBS', '작업 이름', '유형', '시작일', '마감일', '진행률', '상태', '우선순위', '담당자', '예상 시간', '선행 작업', '설명'];

export function exportCSV() {
  const s = useStore.getState();
  const tree = buildTree(s.tasks);
  const eff = computeEffective(s.tasks, tree);
  const rows: (string | number | null)[][] = [HEADERS];
  const mname = (id: ID) => s.members.find((m) => m.id === id)?.name ?? '';
  const walk = (key: string, prefix: string, project: string) => {
    (tree.get(key) ?? []).forEach((t, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const e = eff.get(t.id)!;
      rows.push([
        t.id,
        project,
        t.parentId ?? '',
        wbs,
        t.name,
        t.type,
        e.start != null ? fromDay(e.start) : '',
        e.end != null ? fromDay(e.end) : '',
        e.progress,
        t.status,
        t.priority,
        t.assignees.map(mname).join('; '),
        t.estimate,
        s.deps
          .filter((d) => d.to === t.id)
          .map((d) => `${d.from}:${d.type}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`)
          .join('; '),
        t.description,
      ]);
      walk(t.id, wbs, project);
    });
  };
  for (const p of [...s.projects].sort((a, b) => a.order - b.order)) walk(rootKey(p.id), '', p.name);
  download(`mygantt-${stamp()}.csv`, '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
}

const STATUS_ALIASES: Record<string, Status> = {
  todo: 'todo', '할 일': 'todo', inprogress: 'inprogress', '진행 중': 'inprogress', review: 'review', 검토: 'review', done: 'done', 완료: 'done',
};

/** Import CSV (same columns as export, or at least 작업 이름/name, 시작일/start, 마감일/end). */
export function importCSV(text: string) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('데이터가 없습니다');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = {
    id: col('id'),
    project: col('프로젝트', 'project'),
    parent: col('상위 id', 'parent id', 'parent'),
    name: col('작업 이름', 'name', 'task', 'task name', '이름'),
    type: col('유형', 'type'),
    start: col('시작일', 'start', 'start date'),
    end: col('마감일', 'end', 'due', 'due date', 'end date'),
    progress: col('진행률', 'progress'),
    status: col('상태', 'status'),
    priority: col('우선순위', 'priority'),
    assignees: col('담당자', 'assignee', 'assignees'),
    estimate: col('예상 시간', 'estimate', 'hours'),
    preds: col('선행 작업', 'predecessors', 'dependencies'),
    desc: col('설명', 'description', 'notes'),
  };
  if (ci.name < 0) throw new Error('"작업 이름" 또는 "name" 열이 필요합니다');
  const s = useStore.getState();
  const members = [...s.members];
  const projects = new Map<string, ID>();
  const newProjects: Data['projects'] = [];
  const idMap = new Map<string, ID>();
  const tasks: Task[] = [];
  const pending: { task: Task; parentRaw: string; predsRaw: string }[] = [];
  const order = new Map<string, number>();
  const normDate = (v: string) => {
    const m = v.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  for (const r of rows.slice(1)) {
    const pname = get(r, ci.project) || '가져온 프로젝트';
    if (!projects.has(pname)) {
      const id = uid();
      projects.set(pname, id);
      newProjects.push({ id, name: pname, color: PALETTE[(s.projects.length + newProjects.length) % PALETTE.length], order: s.projects.length + newProjects.length, visible: true, collapsed: false });
    }
    const assignees = get(r, ci.assignees)
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((n) => {
        let m = members.find((mm) => mm.name === n);
        if (!m) {
          m = { id: uid(), name: n, color: PALETTE[members.length % PALETTE.length], capacity: 8 };
          members.push(m);
        }
        return m.id;
      });
    const type = (['task', 'milestone', 'section'].includes(get(r, ci.type)) ? get(r, ci.type) : 'task') as Task['type'];
    const t = newTask({
      projectId: projects.get(pname)!,
      name: get(r, ci.name),
      type,
      start: normDate(get(r, ci.start)),
      end: normDate(get(r, ci.end)),
      progress: Math.max(0, Math.min(100, Number(get(r, ci.progress)) || 0)),
      status: STATUS_ALIASES[get(r, ci.status).toLowerCase()] ?? 'todo',
      priority: (['low', 'medium', 'high'].includes(get(r, ci.priority)) ? get(r, ci.priority) : 'none') as Task['priority'],
      assignees,
      estimate: get(r, ci.estimate) ? Number(get(r, ci.estimate)) : null,
      description: get(r, ci.desc),
    });
    if (t.start && !t.end) t.end = t.start;
    const rawId = get(r, ci.id);
    if (rawId) idMap.set(rawId, t.id);
    tasks.push(t);
    pending.push({ task: t, parentRaw: get(r, ci.parent), predsRaw: get(r, ci.preds) });
  }
  const deps: Data['deps'] = [];
  for (const p of pending) {
    if (p.parentRaw && idMap.has(p.parentRaw)) p.task.parentId = idMap.get(p.parentRaw)!;
    const k = p.task.parentId ?? p.task.projectId;
    p.task.order = order.get(k) ?? 0;
    order.set(k, p.task.order + 1);
    for (const part of p.predsRaw.split(';').map((x) => x.trim()).filter(Boolean)) {
      const m = part.match(/^(.+?):(FS|SS|FF|SF)([+-]\d+)?$/);
      const from = idMap.get(m ? m[1] : part);
      if (from) deps.push({ id: uid(), from, to: p.task.id, type: (m?.[2] ?? 'FS') as DepType, lag: m?.[3] ? Number(m[3]) : 0 });
    }
  }
  s.importData({ projects: newProjects, tasks, deps, members: members.filter((m) => !s.members.some((x) => x.id === m.id)) }, 'merge');
  return tasks.length;
}

export async function exportPNG(node: HTMLElement | null) {
  if (!node) throw new Error('간트 화면에서만 이미지로 내보낼 수 있습니다');
  const url = await toPng(node, {
    backgroundColor: '#ffffff',
    width: node.scrollWidth,
    height: node.scrollHeight,
    pixelRatio: 1.5,
    style: { overflow: 'visible' },
  });
  const a = document.createElement('a');
  a.href = url;
  a.download = `mygantt-${stamp()}.png`;
  a.click();
}

export function printPDF() {
  window.print();
}
