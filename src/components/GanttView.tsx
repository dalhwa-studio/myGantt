import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { DepType, ID, Task } from '../types';
import {
  ROW_H, TIERS, units, useCal, useCritical, useRows, useScale, useTree, type Row, type Scale,
} from '../lib/derived';
import { addWorking, fromDay, isOffDay, toDay, todayDay, weekdayLabel, workingDaysBetween, type Day } from '../lib/date';
import { descendants } from '../lib/schedule';
import { STATUSES, STATUS_COLOR, STATUS_LABEL } from '../lib/util';
import { Avatars, Menu, MemberPicker, Popover, toast, type MenuItem } from './common';

const COLS = [
  { key: 'assignee', label: '담당자', w: 84 },
  { key: 'start', label: '시작일', w: 100 },
  { key: 'end', label: '마감일', w: 100 },
  { key: 'duration', label: '기간', w: 58 },
  { key: 'progress', label: '진행률', w: 64 },
  { key: 'status', label: '상태', w: 88 },
] as const;

type Drag =
  | { mode: 'move' | 'resize-l' | 'resize-r'; id: ID; x0: number; d: number; moved: boolean; affected: Set<ID> }
  | { mode: 'progress'; id: ID; left: number; width: number; value: number }
  | { mode: 'link'; id: ID; side: 'start' | 'end'; x0: number; y0: number; x: number; y: number }
  | { mode: 'create'; id: ID; a: Day; b: Day };

type RowDrag = { id: ID; overKey: string | null; pos: 'before' | 'after' | 'inside' };

const HEAD_H = 52;

export function GanttView({ exportRef }: { exportRef: React.RefObject<HTMLDivElement | null> }) {
  const rows = useRows();
  const scale = useScale();
  const { tree, eff, byId } = useTree();
  const critical = useCritical(eff);
  const cal = useCal();
  const settings = useStore((s) => s.settings);
  const deps = useStore((s) => s.deps);
  const baselines = useStore((s) => s.baselines);
  const selectedId = useStore((s) => s.selectedId);
  const st = useStore.getState;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const rowDragRef = useRef<RowDrag | null>(null);
  rowDragRef.current = rowDrag;
  const [depMenu, setDepMenu] = useState<{ id: ID; x: number; y: number } | null>(null);
  const [ctx, setCtx] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  const [assigneePop, setAssigneePop] = useState<{ id: ID; x: number; y: number } | null>(null);

  const cols = COLS.filter((c) => settings.columns[c.key]);
  const gridW = settings.nameWidth + cols.reduce((a, c) => a + c.w, 0);
  const x = useCallback((d: Day) => (d - scale.start) * scale.dw, [scale]);

  const rowIndex = useMemo(() => {
    const m = new Map<ID, number>();
    rows.forEach((r, i) => r.kind === 'task' && m.set(r.task.id, i));
    return m;
  }, [rows]);

  /* ---------- scroll to today ---------- */
  const scrollToDay = useCallback(
    (d: Day) => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = Math.max(0, x(d) - (el.clientWidth - gridW) / 3);
    },
    [x, gridW],
  );
  useEffect(() => {
    scrollToDay(todayDay());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale.zoom]);
  useEffect(() => {
    const h = () => scrollToDay(todayDay());
    const g = (e: Event) => {
      const id = (e as CustomEvent).detail as ID;
      const ef = eff.get(id);
      if (ef?.start != null) scrollToDay(ef.start);
    };
    window.addEventListener('mygantt:today', h);
    window.addEventListener('mygantt:goto', g);
    return () => {
      window.removeEventListener('mygantt:today', h);
      window.removeEventListener('mygantt:goto', g);
    };
  }, [scrollToDay, eff]);

  /* ---------- display range (with drag preview) ---------- */
  const range = (id: ID): [Day, Day] | null => {
    const e = eff.get(id);
    const dr = drag;
    if (dr?.mode === 'create' && dr.id === id) return [Math.min(dr.a, dr.b), Math.max(dr.a, dr.b)];
    if (!e || e.start == null || e.end == null) return null;
    let s = e.start;
    let en = e.end;
    if (dr && (dr.mode === 'move' || dr.mode === 'resize-l' || dr.mode === 'resize-r')) {
      if (dr.mode === 'move' && dr.affected.has(id)) {
        s += dr.d;
        en += dr.d;
      } else if (dr.mode === 'resize-l' && dr.id === id) s = Math.min(s + dr.d, en);
      else if (dr.mode === 'resize-r' && dr.id === id) en = Math.max(en + dr.d, s);
    }
    return [s, en];
  };

  const localX = (clientX: number) => clientX - (bodyRef.current?.getBoundingClientRect().left ?? 0);
  const localY = (clientY: number) => clientY - (bodyRef.current?.getBoundingClientRect().top ?? 0);
  const dayAt = (clientX: number) => scale.start + Math.floor(localX(clientX) / scale.dw);

  /* ---------- timeline drag handling ---------- */
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'move' || d.mode === 'resize-l' || d.mode === 'resize-r') {
        const delta = Math.round((e.clientX - d.x0) / scale.dw);
        const moved = d.moved || Math.abs(e.clientX - d.x0) > 3;
        if (delta !== d.d || moved !== d.moved) setDrag({ ...d, d: delta, moved });
      } else if (d.mode === 'progress') {
        const v = Math.round(Math.max(0, Math.min(100, ((localX(e.clientX) - d.left) / d.width) * 100)) / 5) * 5;
        if (v !== d.value) setDrag({ ...d, value: v });
      } else if (d.mode === 'link') {
        setDrag({ ...d, x: localX(e.clientX), y: localY(e.clientY) });
      } else if (d.mode === 'create') {
        const b = dayAt(e.clientX);
        if (b !== d.b) setDrag({ ...d, b });
      }
    };
    const up = (e: MouseEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const s = st();
      if (d.mode === 'move') {
        if (!d.moved) s.openDetail(d.id);
        else s.moveTaskBy(d.id, d.d);
      } else if (d.mode === 'resize-l' || d.mode === 'resize-r') {
        const e0 = eff.get(d.id);
        if (!e0 || e0.start == null || e0.end == null || !d.d) return;
        if (d.mode === 'resize-l') s.setTaskRange(d.id, fromDay(Math.min(e0.start + d.d, e0.end)), fromDay(e0.end));
        else s.setTaskRange(d.id, fromDay(e0.start), fromDay(Math.max(e0.end + d.d, e0.start)));
      } else if (d.mode === 'progress') {
        s.updateTask(d.id, { progress: d.value });
      } else if (d.mode === 'create') {
        s.setTaskRange(d.id, fromDay(Math.min(d.a, d.b)), fromDay(Math.max(d.a, d.b)));
      } else if (d.mode === 'link') {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-bar-id]') as HTMLElement | null;
        if (!el) return;
        const to = el.dataset.barId!;
        if (to === d.id) return;
        const r = el.getBoundingClientRect();
        const toSide = e.clientX < r.left + r.width / 2 ? 'S' : 'F';
        const type = ((d.side === 'end' ? 'F' : 'S') + toSide) as DepType;
        if (!s.addDependency(d.id, to, type)) toast('의존성을 추가할 수 없습니다 (중복 또는 순환)');
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag != null, scale, eff]);

  /* ---------- row drag (reorder) ---------- */
  useEffect(() => {
    if (!rowDrag) return;
    const move = (e: MouseEvent) => {
      const cur = rowDragRef.current!;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-row]') as HTMLElement | null;
      if (!el) return setRowDrag({ ...cur, overKey: null });
      const key = el.dataset.row!;
      const r = el.getBoundingClientRect();
      const f = (e.clientY - r.top) / r.height;
      const pos = key.startsWith('p:') ? 'inside' : f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside';
      if (key !== cur.overKey || pos !== cur.pos) setRowDrag({ ...cur, overKey: key, pos });
    };
    const up = () => {
      const cur = rowDragRef.current!;
      setRowDrag(null);
      if (!cur.overKey || cur.overKey === cur.id) return;
      if (cur.overKey.startsWith('p:')) st().moveTaskToProject(cur.id, cur.overKey.slice(2));
      else st().moveTaskTo(cur.id, cur.overKey, cur.pos);
    };
    document.body.classList.add('dragging-row');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      document.body.classList.remove('dragging-row');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowDrag != null]);

  /* ---------- name column resize ---------- */
  const startResizeName = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = settings.nameWidth;
    const mv = (ev: MouseEvent) => st().setSettings({ nameWidth: Math.max(160, Math.min(700, w0 + ev.clientX - x0)) });
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  };

  /* ---------- context menus ---------- */
  const taskMenu = (t: Task, x: number, y: number) => {
    const s = st();
    s.select(t.id);
    const items: MenuItem[] = [
      { label: '상세 열기', icon: '↗', onClick: () => s.openDetail(t.id) },
      { divider: true },
      { label: '위에 작업 추가', onClick: () => addAbove(t) },
      { label: '아래에 작업 추가', hint: 'Enter', onClick: () => s.addTask({ projectId: t.projectId, afterId: t.id }) },
      { label: '하위 작업 추가', onClick: () => s.addTask({ projectId: t.projectId, parentId: t.id }) },
      { label: '아래에 마일스톤 추가', onClick: () => s.addTask({ projectId: t.projectId, afterId: t.id, type: 'milestone' }) },
      { divider: true },
      { label: '들여쓰기', hint: 'Tab', onClick: () => s.indent(t.id) },
      { label: '내어쓰기', hint: '⇧Tab', onClick: () => s.outdent(t.id) },
      {
        label: t.type === 'milestone' ? '작업으로 변환' : '마일스톤으로 변환',
        disabled: t.type === 'section',
        onClick: () => s.updateTask(t.id, { type: t.type === 'milestone' ? 'task' : 'milestone' }),
      },
      { label: t.type === 'section' ? '작업으로 변환' : '섹션으로 변환', onClick: () => s.updateTask(t.id, { type: t.type === 'section' ? 'task' : 'section' }) },
      { label: '복제', hint: '⌘D', onClick: () => s.duplicateTask(t.id) },
      { label: '날짜 지우기', disabled: !t.start, onClick: () => s.setTaskRange(t.id, null, null) },
      { divider: true },
      { label: '삭제', danger: true, hint: 'Del', onClick: () => s.deleteTasks([t.id]) },
    ];
    setCtx({ items, x, y });
  };
  const addAbove = (t: Task) => {
    const s = st();
    const sibs = (tree.get(t.parentId ?? `p:${t.projectId}`) ?? []).filter((x) => x.id !== t.id);
    const idx = sibs.findIndex((x) => x.order > t.order);
    const prev = idx === -1 ? sibs[sibs.length - 1] : sibs[idx - 1];
    if (prev && prev.order < t.order) s.addTask({ projectId: t.projectId, afterId: prev.id });
    else {
      const id = s.addTask({ projectId: t.projectId, parentId: t.parentId });
      s.moveTaskTo(id, t.id, 'before');
      useStore.setState({ past: useStore.getState().past.slice(0, -1) });
    }
  };

  /* ---------- rendering helpers ---------- */
  const [topKind, bottomKind] = TIERS[scale.zoom];
  const topUnits = useMemo(() => units(scale.start, scale.end, topKind, true), [scale, topKind]);
  const bottomUnits = useMemo(() => units(scale.start, scale.end, bottomKind), [scale, bottomKind]);
  const offDays = useMemo(() => {
    if (!settings.showWeekends || (scale.zoom !== 'day' && scale.zoom !== 'week')) return [];
    const out: Day[] = [];
    for (let d = scale.start; d <= scale.end; d++) if (isOffDay(cal, d)) out.push(d);
    return out;
  }, [scale, cal, settings.showWeekends]);
  const today = todayDay();
  const bodyH = Math.max(rows.length * ROW_H, 200);
  const baseline = baselines.find((b) => b.id === settings.showBaseline);

  const anchor = (id: ID, side: 'start' | 'end') => {
    const i = rowIndex.get(id);
    const r = range(id);
    if (i == null || !r) return null;
    const t = byId.get(id)!;
    const y = i * ROW_H + ROW_H / 2;
    if (t.type === 'milestone' && !eff.get(id)!.hasChildren) {
      const cx = x(r[0]) + scale.dw / 2;
      return { x: side === 'start' ? cx - 9 : cx + 9, y };
    }
    return { x: side === 'start' ? x(r[0]) : x(r[1] + 1), y };
  };

  const depPaths = settings.showDependencies
    ? deps.flatMap((d) => {
        const fromSide = d.type[0] === 'F' ? 'end' : 'start';
        const toSide = d.type[1] === 'S' ? 'start' : 'end';
        const a = anchor(d.from, fromSide);
        const b = anchor(d.to, toSide);
        if (!a || !b) return [];
        const g = 10;
        let path: string;
        const ymid = a.y + (b.y > a.y ? ROW_H / 2 : -ROW_H / 2);
        if (fromSide === 'end' && toSide === 'start') {
          path = b.x - g >= a.x + g ? `M${a.x},${a.y} H${b.x - g} V${b.y} H${b.x}` : `M${a.x},${a.y} H${a.x + g} V${ymid} H${b.x - g} V${b.y} H${b.x}`;
        } else if (fromSide === 'start' && toSide === 'start') {
          const xx = Math.min(a.x, b.x) - g;
          path = `M${a.x},${a.y} H${xx} V${b.y} H${b.x}`;
        } else if (fromSide === 'end' && toSide === 'end') {
          const xx = Math.max(a.x, b.x) + g;
          path = `M${a.x},${a.y} H${xx} V${b.y} H${b.x}`;
        } else {
          path = `M${a.x},${a.y} H${a.x - g} V${ymid} H${b.x + g} V${b.y} H${b.x}`;
        }
        const crit = critical.has(d.from) && critical.has(d.to);
        return [{ d, path, crit }];
      })
    : [];

  const startBarDrag = (e: React.MouseEvent, t: Task, mode: 'move' | 'resize-l' | 'resize-r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    st().select(t.id);
    const affected = new Set<ID>([t.id, ...descendants(tree, t.id).map((d) => d.id)]);
    setDrag({ mode, id: t.id, x0: e.clientX, d: 0, moved: false, affected });
  };

  const renderBar = (r: Extract<Row, { kind: 'task' }>, i: number) => {
    const t = r.task;
    const rg = range(t.id);
    const top = i * ROW_H;
    if (!rg) return null;
    const e = eff.get(t.id)!;
    const project = st().projects.find((p) => p.id === t.projectId);
    const color = t.color ?? project?.color ?? '#4f46e5';
    const left = x(rg[0]);
    const width = Math.max(scale.dw, x(rg[1] + 1) - left);
    const isCrit = critical.has(t.id);
    const progress = drag?.mode === 'progress' && drag.id === t.id ? drag.value : e.progress;
    const label = (
      <div className="bar-label" style={{ left: left + width + 8, top }}>
        <span className="bar-label-text">{t.name || '이름 없음'}</span>
        <Avatars ids={t.assignees} size={18} />
      </div>
    );
    const linkDots = (
      <>
        <span
          className="link-dot left"
          onMouseDown={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            setDrag({ mode: 'link', id: t.id, side: 'start', x0: left, y0: top + ROW_H / 2, x: localX(ev.clientX), y: localY(ev.clientY) });
          }}
        />
        <span
          className="link-dot right"
          onMouseDown={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            setDrag({ mode: 'link', id: t.id, side: 'end', x0: left + width, y0: top + ROW_H / 2, x: localX(ev.clientX), y: localY(ev.clientY) });
          }}
        />
      </>
    );
    const onCtx = (ev: React.MouseEvent) => {
      ev.preventDefault();
      taskMenu(t, ev.clientX, ev.clientY);
    };

    if (r.hasChildren) {
      return (
        <div key={t.id}>
          <div
            className={`bar summary${isCrit ? ' critical' : ''}${t.type === 'section' ? ' section' : ''}${selectedId === t.id ? ' selected' : ''}`}
            data-bar-id={t.id}
            style={{ left, width, top: top + 12, '--c': color } as React.CSSProperties}
            onMouseDown={(ev) => startBarDrag(ev, t, 'move')}
            onContextMenu={onCtx}
            title={`${t.name}`}
          >
            <div className="summary-progress" style={{ width: `${progress}%` }} />
            {linkDots}
          </div>
          {label}
        </div>
      );
    }
    if (t.type === 'milestone') {
      const cx = left + scale.dw / 2;
      return (
        <div key={t.id}>
          <div
            className={`milestone${isCrit ? ' critical' : ''}${selectedId === t.id ? ' selected' : ''}${t.status === 'done' ? ' done' : ''}`}
            data-bar-id={t.id}
            style={{ left: cx - 9, top: top + 9, '--c': color } as React.CSSProperties}
            onMouseDown={(ev) => startBarDrag(ev, t, 'move')}
            onContextMenu={onCtx}
            title={t.name}
          >
            <div className="diamond" />
            {linkDots}
          </div>
          <div className="bar-label" style={{ left: cx + 16, top }}>
            <span className="bar-label-text">{t.name || '마일스톤'}</span>
            <span className="bar-label-date">{fromDay(rg[0]).slice(5).replace('-', '/')}</span>
          </div>
        </div>
      );
    }
    return (
      <div key={t.id}>
        <div
          className={`bar${isCrit ? ' critical' : ''}${selectedId === t.id ? ' selected' : ''}${t.status === 'done' ? ' done' : ''}`}
          data-bar-id={t.id}
          style={{ left, width, top: top + 7, '--c': color } as React.CSSProperties}
          onMouseDown={(ev) => startBarDrag(ev, t, 'move')}
          onContextMenu={onCtx}
          title={`${t.name}\n${fromDay(rg[0])} → ${fromDay(rg[1])} · ${progress}%`}
        >
          <div className="bar-progress" style={{ width: `${progress}%` }} />
          {width > 60 && <span className="bar-inner-text">{progress > 0 ? `${progress}%` : ''}</span>}
          <span className="handle l" onMouseDown={(ev) => startBarDrag(ev, t, 'resize-l')} />
          <span className="handle r" onMouseDown={(ev) => startBarDrag(ev, t, 'resize-r')} />
          <span
            className="progress-handle"
            style={{ left: `${progress}%` }}
            onMouseDown={(ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              setDrag({ mode: 'progress', id: t.id, left, width, value: progress });
            }}
          />
          {linkDots}
        </div>
        {label}
      </div>
    );
  };

  /* ---------- render ---------- */
  return (
    <div className="gantt-scroll" ref={scrollRef}>
      <div className="gantt-inner" ref={exportRef} style={{ width: gridW + scale.width }}>
        {/* header */}
        <div className="gantt-head" style={{ height: HEAD_H }}>
          <div className="grid-head" style={{ width: gridW }}>
            <div className="gcell name" style={{ width: settings.nameWidth }}>
              작업 이름
              <span className="col-resizer" onMouseDown={startResizeName} />
            </div>
            {cols.map((c) => (
              <div key={c.key} className="gcell" style={{ width: c.w }}>
                {c.label}
              </div>
            ))}
          </div>
          <div className="time-head" style={{ width: scale.width }}>
            <div className="tier top">
              {topUnits.map((u) => (
                <div key={u.start} className="tunit" style={{ left: x(u.start), width: (u.end - u.start + 1) * scale.dw }}>
                  <span className="sticky-label">{u.label}</span>
                </div>
              ))}
            </div>
            <div className="tier bottom">
              {bottomUnits.map((u) => (
                <div
                  key={u.start}
                  className={`tunit${bottomKind === 'day' && u.start === today ? ' today' : ''}${bottomKind === 'day' && isOffDay(cal, u.start) ? ' off' : ''}`}
                  style={{ left: x(u.start), width: (u.end - u.start + 1) * scale.dw }}
                >
                  {bottomKind === 'day' ? (
                    <>
                      <small>{weekdayLabel(u.start)}</small>
                      {u.label}
                    </>
                  ) : (
                    u.label
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* body */}
        <div className="gantt-body">
          <div className="grid-body" style={{ width: gridW }}>
            {rows.map((r) => (
              <GridRow
                key={r.key}
                row={r}
                cols={cols.map((c) => c.key)}
                colW={cols.map((c) => c.w)}
                nameWidth={settings.nameWidth}
                selected={r.kind === 'task' && selectedId === r.task.id}
                critical={r.kind === 'task' && critical.has(r.task.id)}
                dropPos={rowDrag && rowDrag.overKey === r.key && rowDrag.id !== r.key ? rowDrag.pos : null}
                dragging={rowDrag?.id === r.key}
                onStartDrag={(id) => setRowDrag({ id, overKey: null, pos: 'after' })}
                onContext={(t, ex, ey) => taskMenu(t, ex, ey)}
                onAssignee={(id, ex, ey) => setAssigneePop({ id, x: ex, y: ey })}
                effRange={r.kind === 'task' ? eff.get(r.task.id) ?? null : null}
                cal={cal}
              />
            ))}
            <AddRow />
          </div>

          <div
            className="time-body"
            ref={bodyRef}
            style={{ width: scale.width, height: bodyH + ROW_H }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const i = Math.floor(localY(e.clientY) / ROW_H);
              const r = rows[i];
              if (!r || r.kind !== 'task') return st().select(null);
              st().select(r.task.id);
              if (!r.hasChildren && r.task.type !== 'section' && !r.task.start) {
                e.preventDefault();
                const a = dayAt(e.clientX);
                setDrag({ mode: 'create', id: r.task.id, a, b: r.task.type === 'milestone' ? a : a });
              }
            }}
            onDoubleClick={(e) => {
              const i = Math.floor(localY(e.clientY) / ROW_H);
              const r = rows[i];
              if (r?.kind === 'task') st().openDetail(r.task.id);
            }}
          >
            {/* columns & weekends */}
            {offDays.map((d) => (
              <div key={d} className="offday" style={{ left: x(d), width: scale.dw }} />
            ))}
            {bottomUnits.map((u) => (
              <div key={u.start} className="vline" style={{ left: x(u.start) }} />
            ))}
            {rows.map((r, i) => (
              <div
                key={r.key}
                className={`trow${r.kind === 'project' ? ' project' : ''}${r.kind === 'task' && selectedId === r.task.id ? ' selected' : ''}${
                  r.kind === 'task' && !r.task.start && !r.hasChildren && r.task.type !== 'section' ? ' undated' : ''
                }`}
                style={{ top: i * ROW_H }}
              />
            ))}
            {today >= scale.start && today <= scale.end && (
              <div className="today-line" style={{ left: x(today) + scale.dw / 2 }}>
                <span>오늘</span>
              </div>
            )}

            {/* baseline */}
            {baseline &&
              rows.map((r, i) => {
                if (r.kind !== 'task' || r.hasChildren) return null;
                const b = baseline.snapshot[r.task.id];
                if (!b?.start) return null;
                const s = toDay(b.start);
                const en = b.end ? toDay(b.end) : s;
                const late = eff.get(r.task.id)?.end != null && eff.get(r.task.id)!.end! > en;
                return (
                  <div
                    key={'b' + r.key}
                    className={`baseline-bar${late ? ' late' : ''}`}
                    title={`베이스라인: ${b.start} → ${b.end}`}
                    style={{ left: x(s), width: Math.max(4, (en - s + 1) * scale.dw), top: i * ROW_H + 29 }}
                  />
                );
              })}

            {/* bars */}
            {rows.map((r, i) => (r.kind === 'task' ? renderBar(r, i) : <ProjectBar key={r.key} projectId={r.project.id} top={i * ROW_H} x={x} scale={scale} />))}

            {/* dependencies */}
            <svg className="deps" width={scale.width} height={bodyH}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
                </marker>
                <marker id="arrow-crit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#ef4444" />
                </marker>
              </defs>
              {depPaths.map(({ d, path, crit }) => (
                <g key={d.id} className={`dep${crit ? ' critical' : ''}${depMenu?.id === d.id ? ' active' : ''}`}>
                  <path d={path} className="dep-hit" onClick={(e) => setDepMenu({ id: d.id, x: e.clientX, y: e.clientY })} />
                  <path d={path} className="dep-line" markerEnd={crit ? 'url(#arrow-crit)' : 'url(#arrow)'} />
                </g>
              ))}
              {drag?.mode === 'link' && <line x1={drag.x0} y1={drag.y0} x2={drag.x} y2={drag.y} className="link-preview" />}
            </svg>
          </div>
        </div>
      </div>

      {depMenu && <DepPopover id={depMenu.id} x={depMenu.x} y={depMenu.y} onClose={() => setDepMenu(null)} />}
      {ctx && (
        <Popover anchor={{ x: ctx.x, y: ctx.y }} onClose={() => setCtx(null)}>
          <Menu items={ctx.items} onClose={() => setCtx(null)} />
        </Popover>
      )}
      {assigneePop && (
        <Popover anchor={{ x: assigneePop.x, y: assigneePop.y }} onClose={() => setAssigneePop(null)}>
          <AssigneeEditor id={assigneePop.id} />
        </Popover>
      )}
    </div>
  );
}

function AssigneeEditor({ id }: { id: ID }) {
  const t = useStore((s) => s.tasks.find((x) => x.id === id));
  const update = useStore((s) => s.updateTask);
  if (!t) return null;
  return <MemberPicker value={t.assignees} onChange={(a) => update(id, { assignees: a })} />;
}

function ProjectBar({ projectId, top, x, scale }: { projectId: ID; top: number; x: (d: Day) => number; scale: Scale }) {
  const tasks = useStore((s) => s.tasks);
  const project = useStore((s) => s.projects.find((p) => p.id === projectId));
  const { eff } = useTree();
  let s: Day | null = null;
  let e: Day | null = null;
  for (const t of tasks) {
    if (t.projectId !== projectId || t.parentId) continue;
    const ef = eff.get(t.id);
    if (ef?.start == null || ef.end == null) continue;
    s = s == null ? ef.start : Math.min(s, ef.start);
    e = e == null ? ef.end : Math.max(e, ef.end);
  }
  if (s == null || e == null || !project) return null;
  return <div className="project-bar" style={{ left: x(s), width: (e - s + 1) * scale.dw, top: top + 15, background: project.color }} />;
}

function DepPopover({ id, x, y, onClose }: { id: ID; x: number; y: number; onClose: () => void }) {
  const dep = useStore((s) => s.deps.find((d) => d.id === id));
  const tasks = useStore((s) => s.tasks);
  const update = useStore((s) => s.updateDependency);
  const del = useStore((s) => s.deleteDependency);
  if (!dep) return null;
  const name = (tid: ID) => tasks.find((t) => t.id === tid)?.name || '이름 없음';
  return (
    <Popover anchor={{ x, y: y + 8 }} onClose={onClose}>
      <div className="dep-pop">
        <div className="dep-pop-title">
          {name(dep.from)} → {name(dep.to)}
        </div>
        <label>
          유형
          <select value={dep.type} onChange={(e) => update(id, { type: e.target.value as DepType })}>
            <option value="FS">완료 → 시작 (FS)</option>
            <option value="SS">시작 → 시작 (SS)</option>
            <option value="FF">완료 → 완료 (FF)</option>
            <option value="SF">시작 → 완료 (SF)</option>
          </select>
        </label>
        <label>
          지연(일)
          <input type="number" value={dep.lag} onChange={(e) => update(id, { lag: Number(e.target.value) || 0 })} />
        </label>
        <button
          className="btn danger"
          onClick={() => {
            del(id);
            onClose();
          }}
        >
          의존성 삭제
        </button>
      </div>
    </Popover>
  );
}

function AddRow() {
  const projects = useStore((s) => s.projects);
  const addTask = useStore((s) => s.addTask);
  const visible = projects.filter((p) => p.visible).sort((a, b) => a.order - b.order);
  const last = visible[visible.length - 1];
  if (!last) return <div className="grid-row add-row muted">사이드바에서 프로젝트를 추가하세요</div>;
  return (
    <div className="grid-row add-row" onClick={() => addTask({ projectId: last.id })}>
      <span className="add-plus">＋</span> 작업 추가
    </div>
  );
}

/* ================= grid row ================= */

function GridRow({
  row,
  cols,
  colW,
  nameWidth,
  selected,
  critical,
  dropPos,
  dragging,
  onStartDrag,
  onContext,
  onAssignee,
  effRange,
  cal,
}: {
  row: Row;
  cols: string[];
  colW: number[];
  nameWidth: number;
  selected: boolean;
  critical: boolean;
  dropPos: RowDrag['pos'] | null;
  dragging: boolean;
  onStartDrag: (id: ID) => void;
  onContext: (t: Task, x: number, y: number) => void;
  onAssignee: (id: ID, x: number, y: number) => void;
  effRange: { start: Day | null; end: Day | null; progress: number } | null;
  cal: ReturnType<typeof useCal>;
}) {
  const s = useStore.getState;
  const editingId = useStore((x) => x.editingId);
  const dropCls = dropPos ? ` drop-${dropPos}` : '';

  if (row.kind === 'project') {
    const p = row.project;
    return (
      <div className="grid-row project-row" data-row={row.key} style={{ height: ROW_H }}>
        <div className={`gcell name${dropCls}`} style={{ width: nameWidth + colW.reduce((a, b) => a + b, 0) }}>
          <button className="caret" onClick={() => s().updateProject(p.id, { collapsed: !p.collapsed }, false)}>
            {p.collapsed ? '▸' : '▾'}
          </button>
          <span className="proj-dot" style={{ background: p.color }} />
          <span className="proj-name">{p.name}</span>
          <button className="row-add" title="작업 추가" onClick={() => s().addTask({ projectId: p.id })}>
            ＋
          </button>
        </div>
      </div>
    );
  }

  const t = row.task;
  const editing = editingId === t.id;
  const isParent = row.hasChildren;
  const ef = effRange;
  const startDay = ef?.start ?? null;
  const endDay = ef?.end ?? null;
  const dur = startDay != null && endDay != null ? workingDaysBetween(cal, startDay, endDay) : null;

  const cell = (key: string, w: number): ReactNode => {
    switch (key) {
      case 'assignee':
        return (
          <div
            key={key}
            className="gcell clickable"
            style={{ width: w }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onAssignee(t.id, r.left, r.bottom + 2);
            }}
          >
            {t.assignees.length ? <Avatars ids={t.assignees} size={22} /> : <span className="placeholder">＋</span>}
          </div>
        );
      case 'start':
      case 'end': {
        const v = key === 'start' ? startDay : endDay;
        if (isParent || t.type === 'section' || (key === 'end' && t.type === 'milestone'))
          return (
            <div key={key} className="gcell muted" style={{ width: w }}>
              {v != null ? fromDay(v).slice(2).replace(/-/g, '.') : ''}
            </div>
          );
        return (
          <div key={key} className="gcell" style={{ width: w }}>
            <input
              type="date"
              className="cell-input"
              value={v != null ? fromDay(v) : ''}
              onChange={(e) => {
                const val = e.target.value || null;
                if (key === 'start') {
                  if (!val) return s().setTaskRange(t.id, null, null);
                  // keep duration when moving start
                  const len = startDay != null && endDay != null ? endDay - startDay : 0;
                  s().setTaskRange(t.id, val, fromDay(toDay(val) + len));
                } else {
                  if (!val) return;
                  s().setTaskRange(t.id, t.start ?? val, val);
                }
              }}
            />
          </div>
        );
      }
      case 'duration':
        return (
          <div key={key} className="gcell" style={{ width: w }}>
            {isParent || t.type !== 'task' ? (
              <span className="muted">{dur != null && t.type !== 'milestone' ? `${dur}일` : ''}</span>
            ) : (
              <input
                className="cell-input num"
                type="number"
                min={1}
                value={dur ?? ''}
                placeholder="-"
                onChange={(e) => {
                  const n = Math.max(1, Number(e.target.value) || 1);
                  const st0 = startDay ?? todayDay();
                  s().setTaskRange(t.id, fromDay(st0), fromDay(addWorking(cal, st0, n)));
                }}
              />
            )}
          </div>
        );
      case 'progress':
        return (
          <div key={key} className="gcell" style={{ width: w }}>
            {isParent ? (
              <span className="muted">{ef?.progress ?? 0}%</span>
            ) : (
              <input
                className="cell-input num"
                type="number"
                min={0}
                max={100}
                step={5}
                value={t.progress}
                onChange={(e) => s().updateTask(t.id, { progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
            )}
          </div>
        );
      case 'status':
        return (
          <div key={key} className="gcell" style={{ width: w }}>
            <select
              className="cell-input status-select"
              style={{ color: STATUS_COLOR[t.status] }}
              value={t.status}
              onChange={(e) => s().updateTask(t.id, { status: e.target.value as Task['status'] })}
            >
              {STATUSES.map((x) => (
                <option key={x} value={x}>
                  {STATUS_LABEL[x]}
                </option>
              ))}
            </select>
          </div>
        );
    }
    return null;
  };

  return (
    <div
      className={`grid-row${selected ? ' selected' : ''}${t.type === 'section' ? ' section-row' : ''}${dragging ? ' dragging' : ''}`}
      data-row={row.key}
      style={{ height: ROW_H }}
      onMouseDown={() => s().select(t.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(t, e.clientX, e.clientY);
      }}
    >
      <div className={`gcell name${dropCls}`} style={{ width: nameWidth, paddingLeft: 4 + (row.depth - 1) * 18 }}>
        <span
          className="drag-handle"
          title="드래그하여 이동"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStartDrag(t.id);
          }}
        >
          ⋮⋮
        </span>
        {isParent ? (
          <button className="caret" onClick={() => s().updateTask(t.id, { collapsed: !t.collapsed })}>
            {t.collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="caret-space" />
        )}
        {t.type === 'milestone' ? (
          <span className={`ms-icon${t.status === 'done' ? ' done' : ''}`} onClick={() => s().updateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}>
            ◆
          </span>
        ) : t.type === 'section' ? null : (
          <button
            className={`check${t.status === 'done' ? ' done' : ''}`}
            title="완료 표시"
            onClick={() => s().updateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
          >
            {t.status === 'done' ? '✓' : ''}
          </button>
        )}
        {editing ? (
          <NameInput task={t} />
        ) : (
          <span
            className={`task-name${t.status === 'done' ? ' done' : ''}${critical ? ' critical' : ''}`}
            onDoubleClick={() => s().setEditing(t.id)}
          >
            {t.name || <span className="placeholder">이름 없음</span>}
          </span>
        )}
        {(t.comments.length > 0 || t.checklist.length > 0) && (
          <span className="row-meta">
            {t.checklist.length > 0 && `☑ ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}`}
            {t.comments.length > 0 && ` 💬${t.comments.length}`}
          </span>
        )}
        <button className="row-open" title="상세 열기" onClick={() => s().openDetail(t.id)}>
          ↗
        </button>
      </div>
      {cols.map((c, i) => cell(c, colW[i]))}
    </div>
  );
}

function NameInput({ task }: { task: Task }) {
  const [v, setV] = useState(task.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const tabbing = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const s = useStore.getState;
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if (v !== task.name) s().updateTask(task.id, { name: v });
    s().setEditing(null);
  };
  return (
    <input
      ref={ref}
      className="name-input"
      value={v}
      placeholder="작업 이름"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => !tabbing.current && commit()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          if (task.type === 'section') s().addTask({ projectId: task.projectId, parentId: task.id });
          else s().addTask({ projectId: task.projectId, afterId: task.id });
        } else if (e.key === 'Escape') {
          done.current = true;
          s().setEditing(null);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (v !== s().tasks.find((x) => x.id === task.id)?.name) s().updateTask(task.id, { name: v });
          tabbing.current = true;
          if (e.shiftKey) s().outdent(task.id);
          else s().indent(task.id);
          setTimeout(() => {
            tabbing.current = false;
            ref.current?.focus();
          }, 0);
        }
      }}
    />
  );
}
