import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Baseline, Data, Dependency, DepType, Filters, ID, Member, Project, Settings, Task, TaskType,
} from './types';
import { autoSchedule, buildTree, createsCycle, descendants, parentKey, rootKey, shiftTask } from './lib/schedule';
import { fromDay, makeCal, toDay, todayDay } from './lib/date';
import { PALETTE, uid } from './lib/util';
import { demoData } from './demo';
import { newTask } from './lib/task';
export { newTask };

export const DEFAULT_SETTINGS: Settings = {
  view: 'gantt',
  zoom: 'week',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  autoSchedule: true,
  workingDaysOnly: false,
  showCritical: false,
  showDependencies: true,
  showWeekends: true,
  showBaseline: null,
  currentUser: null,
  nameWidth: 280,
  columns: { assignee: true, start: true, end: true, duration: true, progress: false, status: false },
  sidebarOpen: true,
  workloadMetric: 'hours',
};

const DEFAULT_FILTERS: Filters = { search: '', assignee: 'all', status: 'all', hideDone: false };

export interface NewTaskOpts {
  projectId: ID;
  parentId?: ID | null;
  afterId?: ID | null;
  type?: TaskType;
  name?: string;
  start?: string | null;
  end?: string | null;
}

interface State extends Data {
  settings: Settings;
  filters: Filters;
  selectedId: ID | null;
  detailId: ID | null;
  editingId: ID | null;
  /** temporary timeline range used while exporting an image/PDF */
  exportRange: { start: number; end: number } | null;
  /** true while rendering an export (inputs are drawn as plain text) */
  exporting: boolean;
  past: Data[];
  future: Data[];

  undo(): void;
  redo(): void;
  setSettings(p: Partial<Settings>): void;
  setFilters(p: Partial<Filters>): void;
  select(id: ID | null): void;
  openDetail(id: ID | null): void;
  setEditing(id: ID | null): void;

  addProject(name?: string): ID;
  updateProject(id: ID, p: Partial<Project>, history?: boolean): void;
  deleteProject(id: ID): void;

  addTask(o: NewTaskOpts): ID;
  updateTask(id: ID, p: Partial<Task>): void;
  setTaskRange(id: ID, start: string | null, end: string | null): void;
  moveTaskBy(id: ID, delta: number): void;
  deleteTasks(ids: ID[]): void;
  duplicateTask(id: ID): void;
  indent(id: ID): void;
  outdent(id: ID): void;
  moveTaskTo(id: ID, targetId: ID, pos: 'before' | 'after' | 'inside'): void;
  moveTaskToProject(id: ID, projectId: ID): void;
  setCollapsedAll(collapsed: boolean): void;

  addDependency(from: ID, to: ID, type?: DepType): boolean;
  updateDependency(id: ID, p: Partial<Dependency>): void;
  deleteDependency(id: ID): void;

  addMember(name: string): ID;
  updateMember(id: ID, p: Partial<Member>): void;
  deleteMember(id: ID): void;

  saveBaseline(name: string): void;
  deleteBaseline(id: ID): void;

  importData(d: Partial<Data>, mode: 'replace' | 'merge'): void;
  resetDemo(): void;
}

const pickData = (s: Data): Data => ({
  projects: s.projects,
  tasks: s.tasks,
  deps: s.deps,
  members: s.members,
  baselines: s.baselines,
});

/** Renumber siblings so orders are 0..n-1 following given id order */
function renumber(tasks: Task[], ids: ID[]) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  for (const t of tasks) if (idx.has(t.id)) t.order = idx.get(t.id)!;
}

function siblingsOf(tasks: Task[], key: string) {
  return tasks.filter((t) => parentKey(t) === key).sort((a, b) => a.order - b.order);
}

function insertAt(tasks: Task[], t: Task, key: string, index: number) {
  const sibs = siblingsOf(tasks, key).filter((s) => s.id !== t.id);
  sibs.splice(Math.max(0, Math.min(index, sibs.length)), 0, t);
  renumber(tasks, sibs.map((s) => s.id));
}

function setProjectDeep(tasks: Task[], id: ID, projectId: ID) {
  const tree = buildTree(tasks);
  const ids = new Set([id, ...descendants(tree, id).map((d) => d.id)]);
  for (const t of tasks) if (ids.has(t.id)) t.projectId = projectId;
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** apply a mutation with undo history */
      const mutate = (fn: (d: Data) => void | false) => {
        const s = get();
        const prev = pickData(s);
        const next = structuredClone(prev);
        if (fn(next) === false) return;
        set({ ...next, past: [...s.past, prev].slice(-100), future: [] });
      };
      const cal = () => {
        const st = get().settings;
        return makeCal(st.workingDays, st.holidays, st.workingDaysOnly);
      };
      const schedule = (d: Data, seeds: ID[]) => {
        if (!get().settings.autoSchedule || !d.deps.length) return;
        d.tasks = autoSchedule(d.tasks, d.deps, seeds, cal());
      };

      return {
        ...demoData(),
        settings: DEFAULT_SETTINGS,
        filters: DEFAULT_FILTERS,
        selectedId: null,
        detailId: null,
        editingId: null,
        exportRange: null,
        exporting: false,
        past: [],
        future: [],

        undo() {
          const s = get();
          if (!s.past.length) return;
          const prev = s.past[s.past.length - 1];
          set({ ...prev, past: s.past.slice(0, -1), future: [pickData(s), ...s.future] });
        },
        redo() {
          const s = get();
          if (!s.future.length) return;
          const [next, ...rest] = s.future;
          set({ ...next, past: [...s.past, pickData(s)], future: rest });
        },
        setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
        setFilters: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
        select: (id) => set({ selectedId: id }),
        openDetail: (id) => set({ detailId: id, selectedId: id ?? get().selectedId }),
        setEditing: (id) => set({ editingId: id }),

        addProject(name) {
          const id = uid();
          mutate((d) => {
            d.projects.push({
              id,
              name: name || '새 프로젝트',
              color: PALETTE[d.projects.length % PALETTE.length],
              order: d.projects.length,
              visible: true,
              collapsed: false,
            });
          });
          return id;
        },
        updateProject(id, p, history = true) {
          if (!history) {
            set((s) => ({ projects: s.projects.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
            return;
          }
          mutate((d) => {
            const x = d.projects.find((x) => x.id === id);
            if (x) Object.assign(x, p);
          });
        },
        deleteProject(id) {
          mutate((d) => {
            const ids = new Set(d.tasks.filter((t) => t.projectId === id).map((t) => t.id));
            d.projects = d.projects.filter((p) => p.id !== id);
            d.tasks = d.tasks.filter((t) => !ids.has(t.id));
            d.deps = d.deps.filter((x) => !ids.has(x.from) && !ids.has(x.to));
          });
        },

        addTask(o) {
          const id = uid();
          mutate((d) => {
            let parentId = o.parentId ?? null;
            let index = Infinity;
            if (o.afterId) {
              const after = d.tasks.find((t) => t.id === o.afterId);
              if (after) {
                parentId = after.parentId;
                index = after.order + 1;
              }
            }
            const type = o.type ?? 'task';
            let start = o.start ?? null;
            let end = o.end ?? null;
            if (o.start === undefined && type !== 'section') {
              // sensible defaults: copy from previous sibling, or today
              const t0 = todayDay();
              start = fromDay(t0);
              end = fromDay(type === 'milestone' ? t0 : t0 + 2);
            }
            const t = newTask({
              id,
              projectId: o.projectId,
              parentId,
              type,
              name: o.name ?? '',
              start: type === 'section' ? null : start,
              end: type === 'section' ? null : end,
            });
            d.tasks.push(t);
            insertAt(d.tasks, t, parentKey(t), index);
            if (parentId) {
              const p = d.tasks.find((x) => x.id === parentId);
              if (p) p.collapsed = false;
            }
          });
          set({ selectedId: id, editingId: id });
          return id;
        },
        updateTask(id, p) {
          mutate((d) => {
            const t = d.tasks.find((x) => x.id === id);
            if (!t) return false;
            Object.assign(t, p);
            if (p.status === 'done') t.progress = 100;
            else if (p.status && t.progress === 100) t.progress = p.status === 'todo' ? 0 : 50;
            if (p.progress != null && p.status === undefined) {
              if (p.progress >= 100) t.status = 'done';
              else if (t.status === 'done') t.status = 'inprogress';
              else if (p.progress > 0 && t.status === 'todo') t.status = 'inprogress';
            }
            if (t.type === 'milestone' && t.start) t.end = t.start;
            if (t.start && t.end && toDay(t.end) < toDay(t.start)) t.end = t.start;
            if ('start' in p || 'end' in p || 'type' in p) schedule(d, [id]);
          });
        },
        setTaskRange(id, start, end) {
          get().updateTask(id, { start, end });
        },
        moveTaskBy(id, delta) {
          if (!delta) return;
          mutate((d) => {
            const map = new Map(d.tasks.map((t) => [t.id, t]));
            shiftTask(map, buildTree(d.tasks), id, delta);
            d.tasks = d.tasks.map((t) => map.get(t.id)!);
            schedule(d, [id]);
          });
        },
        deleteTasks(ids) {
          mutate((d) => {
            const tree = buildTree(d.tasks);
            const all = new Set<ID>();
            for (const id of ids) {
              all.add(id);
              for (const x of descendants(tree, id)) all.add(x.id);
            }
            d.tasks = d.tasks.filter((t) => !all.has(t.id));
            d.deps = d.deps.filter((x) => !all.has(x.from) && !all.has(x.to));
          });
          const s = get();
          if (s.detailId && ids.includes(s.detailId)) set({ detailId: null });
          if (s.selectedId && ids.includes(s.selectedId)) set({ selectedId: null });
        },
        duplicateTask(id) {
          mutate((d) => {
            const tree = buildTree(d.tasks);
            const src = d.tasks.find((t) => t.id === id);
            if (!src) return false;
            const idMap = new Map<ID, ID>();
            const subtree = [src, ...descendants(tree, id)];
            for (const t of subtree) idMap.set(t.id, uid());
            const copies = subtree.map((t) => ({
              ...structuredClone(t),
              id: idMap.get(t.id)!,
              parentId: t.id === id ? t.parentId : idMap.get(t.parentId!) ?? t.parentId,
              name: t.id === id ? `${t.name} (복사본)` : t.name,
              createdAt: new Date().toISOString(),
            }));
            d.tasks.push(...copies);
            insertAt(d.tasks, copies[0], parentKey(copies[0]), src.order + 1);
            for (const dep of d.deps.slice()) {
              if (idMap.has(dep.from) && idMap.has(dep.to))
                d.deps.push({ ...dep, id: uid(), from: idMap.get(dep.from)!, to: idMap.get(dep.to)! });
            }
          });
        },
        indent(id) {
          mutate((d) => {
            const t = d.tasks.find((x) => x.id === id);
            if (!t) return false;
            const sibs = siblingsOf(d.tasks, parentKey(t));
            const i = sibs.findIndex((s) => s.id === id);
            if (i <= 0) return false;
            const prev = sibs[i - 1];
            if (prev.type === 'milestone') return false;
            t.parentId = prev.id;
            prev.collapsed = false;
            insertAt(d.tasks, t, prev.id, Infinity);
            renumber(d.tasks, sibs.filter((s) => s.id !== id).map((s) => s.id));
          });
        },
        outdent(id) {
          mutate((d) => {
            const t = d.tasks.find((x) => x.id === id);
            if (!t || !t.parentId) return false;
            const parent = d.tasks.find((x) => x.id === t.parentId)!;
            const oldKey = parentKey(t);
            t.parentId = parent.parentId;
            insertAt(d.tasks, t, parentKey(t), parent.order + 1);
            renumber(d.tasks, siblingsOf(d.tasks, oldKey).map((s) => s.id));
          });
        },
        moveTaskTo(id, targetId, pos) {
          if (id === targetId) return;
          mutate((d) => {
            const tree = buildTree(d.tasks);
            if (descendants(tree, id).some((x) => x.id === targetId)) return false;
            const t = d.tasks.find((x) => x.id === id);
            const target = d.tasks.find((x) => x.id === targetId);
            if (!t || !target) return false;
            if (pos === 'inside' && target.type === 'milestone') pos = 'after';
            const oldKey = parentKey(t);
            if (t.projectId !== target.projectId) setProjectDeep(d.tasks, id, target.projectId);
            if (pos === 'inside') {
              t.parentId = target.id;
              target.collapsed = false;
              insertAt(d.tasks, t, target.id, Infinity);
            } else {
              t.parentId = target.parentId;
              const sibs = siblingsOf(d.tasks, parentKey(target)).filter((s) => s.id !== id);
              const ti = sibs.findIndex((s) => s.id === targetId);
              insertAt(d.tasks, t, parentKey(target), pos === 'before' ? ti : ti + 1);
            }
            renumber(d.tasks, siblingsOf(d.tasks, oldKey).map((s) => s.id));
          });
        },
        moveTaskToProject(id, projectId) {
          mutate((d) => {
            const t = d.tasks.find((x) => x.id === id);
            if (!t) return false;
            const oldKey = parentKey(t);
            setProjectDeep(d.tasks, id, projectId);
            t.parentId = null;
            insertAt(d.tasks, t, rootKey(projectId), Infinity);
            renumber(d.tasks, siblingsOf(d.tasks, oldKey).map((s) => s.id));
          });
        },
        setCollapsedAll(collapsed) {
          mutate((d) => {
            const parents = new Set(d.tasks.map((t) => t.parentId).filter(Boolean));
            for (const t of d.tasks) if (parents.has(t.id)) t.collapsed = collapsed;
            for (const p of d.projects) p.collapsed = false;
          });
        },

        addDependency(from, to, type = 'FS') {
          const s = get();
          if (s.deps.some((d) => d.from === from && d.to === to)) return false;
          if (createsCycle(s.deps, from, to)) return false;
          const tree = buildTree(s.tasks);
          // no links between a parent and its own descendants
          if (descendants(tree, from).some((x) => x.id === to) || descendants(tree, to).some((x) => x.id === from))
            return false;
          mutate((d) => {
            d.deps.push({ id: uid(), from, to, type, lag: 0 });
            schedule(d, [from]);
          });
          return true;
        },
        updateDependency(id, p) {
          mutate((d) => {
            const x = d.deps.find((x) => x.id === id);
            if (!x) return false;
            Object.assign(x, p);
            schedule(d, [x.from]);
          });
        },
        deleteDependency(id) {
          mutate((d) => {
            d.deps = d.deps.filter((x) => x.id !== id);
          });
        },

        addMember(name) {
          const id = uid();
          mutate((d) => {
            d.members.push({ id, name, color: PALETTE[(d.members.length + 3) % PALETTE.length], capacity: 8 });
          });
          return id;
        },
        updateMember(id, p) {
          mutate((d) => {
            const m = d.members.find((x) => x.id === id);
            if (m) Object.assign(m, p);
          });
        },
        deleteMember(id) {
          mutate((d) => {
            d.members = d.members.filter((m) => m.id !== id);
            for (const t of d.tasks) t.assignees = t.assignees.filter((a) => a !== id);
          });
          if (get().settings.currentUser === id) get().setSettings({ currentUser: null });
        },

        saveBaseline(name) {
          const b: Baseline = {
            id: uid(),
            name,
            createdAt: new Date().toISOString(),
            snapshot: Object.fromEntries(get().tasks.map((t) => [t.id, { start: t.start, end: t.end }])),
          };
          mutate((d) => {
            d.baselines.push(b);
          });
          get().setSettings({ showBaseline: b.id });
        },
        deleteBaseline(id) {
          mutate((d) => {
            d.baselines = d.baselines.filter((b) => b.id !== id);
          });
          if (get().settings.showBaseline === id) get().setSettings({ showBaseline: null });
        },

        importData(data, mode) {
          mutate((d) => {
            if (mode === 'replace') {
              d.projects = data.projects ?? [];
              d.tasks = data.tasks ?? [];
              d.deps = data.deps ?? [];
              d.members = data.members ?? d.members;
              d.baselines = data.baselines ?? [];
            } else {
              d.projects.push(...(data.projects ?? []));
              d.tasks.push(...(data.tasks ?? []));
              d.deps.push(...(data.deps ?? []));
              const known = new Set(d.members.map((m) => m.id));
              d.members.push(...(data.members ?? []).filter((m) => !known.has(m.id)));
            }
            d.tasks = d.tasks.map((t) => newTask(t));
          });
          set({ detailId: null, selectedId: null });
        },
        resetDemo() {
          mutate((d) => {
            Object.assign(d, demoData());
          });
          set({ detailId: null, selectedId: null });
        },
      };
    },
    {
      name: 'mygantt-v1',
      version: 1,
      partialize: (s) => ({ ...pickData(s), settings: s.settings }),
      merge: (persisted, current) => {
        const p = persisted as Partial<State>;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p?.settings ?? {}), columns: { ...current.settings.columns, ...(p?.settings?.columns ?? {}) } },
        };
      },
    },
  ),
);
