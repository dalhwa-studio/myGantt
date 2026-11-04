import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { ID, Member, Task } from '../types';
import { units, useCal, useScale, useTree, type UnitKind } from '../lib/derived';
import { isWorking, todayDay, workingDaysBetween } from '../lib/date';
import { Avatar } from './common';

const NAME_W = 240;

/**
 * Workload: for each member, sum of estimated hours per bucket (estimate spread
 * evenly over the task's working days and split among assignees), or count of
 * active tasks per bucket.
 */
export function WorkloadView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const members = useStore((s) => s.members);
  const metric = useStore((s) => s.settings.workloadMetric);
  const setSettings = useStore((s) => s.setSettings);
  const open = useStore((s) => s.openDetail);
  const scale = useScale();
  const cal = useCal();
  const { tree, eff } = useTree();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const bucketKind: UnitKind = scale.zoom === 'day' ? 'day' : scale.zoom === 'week' ? 'week' : 'month';
  const buckets = useMemo(() => units(scale.start, scale.end, bucketKind), [scale, bucketKind]);
  const x = (d: number) => (d - scale.start) * scale.dw;
  const visible = new Set(projects.filter((p) => p.visible).map((p) => p.id));
  const leaves = tasks.filter((t) => visible.has(t.projectId) && t.type === 'task' && !(tree.get(t.id) ?? []).length);
  const lanes: { key: string; member: Member | null; tasks: Task[] }[] = [
    ...members.map((m) => ({ key: m.id, member: m, tasks: leaves.filter((t) => t.assignees.includes(m.id)) })),
    { key: 'none', member: null, tasks: leaves.filter((t) => !t.assignees.length) },
  ];
  const today = todayDay();
  const calAll = { ...cal, enabled: true };

  const load = (memberId: ID | null, ts: Task[], a: number, b: number) => {
    let v = 0;
    for (const t of ts) {
      const e = eff.get(t.id);
      if (e?.start == null || e.end == null) continue;
      const s = Math.max(a, e.start);
      const en = Math.min(b, e.end);
      if (s > en) continue;
      if (metric === 'tasks') {
        v += 1;
        continue;
      }
      if (t.estimate == null) continue;
      const total = Math.max(1, workingDaysBetween(calAll, e.start, e.end));
      const inBucket = workingDaysBetween(calAll, s, en);
      const share = memberId ? 1 / Math.max(1, t.assignees.length) : 1;
      v += (t.estimate / total) * inBucket * share;
    }
    return v;
  };
  const capacityOf = (m: Member | null, a: number, b: number) => {
    if (!m) return Infinity;
    let wd = 0;
    for (let d = a; d <= b; d++) if (isWorking(calAll, d)) wd++;
    return metric === 'hours' ? m.capacity * wd : bucketKind === 'day' ? 2 : bucketKind === 'week' ? 3 : 6;
  };

  return (
    <div className="workload">
      <div className="workload-bar">
        <span className="muted">측정 기준</span>
        <div className="seg">
          <button className={metric === 'hours' ? 'on' : ''} onClick={() => setSettings({ workloadMetric: 'hours' })}>
            예상 시간
          </button>
          <button className={metric === 'tasks' ? 'on' : ''} onClick={() => setSettings({ workloadMetric: 'tasks' })}>
            작업 수
          </button>
        </div>
        <span className="legend">
          <i className="wl ok" /> 여유 <i className="wl full" /> 적정 <i className="wl over" /> 초과
        </span>
        <span className="muted small">팀원별 용량(시간/일)은 설정에서 변경할 수 있습니다. 시간 기준은 '예상 시간'이 입력된 작업만 계산합니다.</span>
      </div>
      <div className="gantt-scroll">
        <div className="gantt-inner" style={{ width: NAME_W + scale.width }}>
          <div className="gantt-head" style={{ height: 34 }}>
            <div className="grid-head" style={{ width: NAME_W }}>
              <div className="gcell name" style={{ width: NAME_W }}>
                팀원
              </div>
            </div>
            <div className="time-head" style={{ width: scale.width, height: 34 }}>
              <div className="tier bottom" style={{ top: 0, height: 34 }}>
                {buckets.map((u) => (
                  <div key={u.start} className={`tunit${u.start <= today && today <= u.end ? ' today' : ''}`} style={{ left: x(u.start), width: (u.end - u.start + 1) * scale.dw }}>
                    {u.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {lanes.map((lane) => {
            const isOpen = expanded.has(lane.key);
            if (!lane.member && !lane.tasks.length) return null;
            return (
              <div key={lane.key}>
                <div className="wl-row">
                  <div
                    className="wl-name"
                    style={{ width: NAME_W }}
                    onClick={() => {
                      const n = new Set(expanded);
                      if (isOpen) n.delete(lane.key);
                      else n.add(lane.key);
                      setExpanded(n);
                    }}
                  >
                    <span className="caret">{isOpen ? '▾' : '▸'}</span>
                    {lane.member ? <Avatar m={lane.member} size={24} /> : <span className="avatar" style={{ background: '#cbd5e1', width: 24, height: 24 }}>?</span>}
                    <span>{lane.member?.name ?? '미지정'}</span>
                    <span className="muted small">{lane.tasks.length}개 작업</span>
                  </div>
                  <div className="wl-cells" style={{ width: scale.width }}>
                    {buckets.map((u) => {
                      const v = load(lane.member?.id ?? null, lane.tasks, u.start, u.end);
                      if (!v) return null;
                      const cap = capacityOf(lane.member, u.start, u.end);
                      const ratio = v / cap;
                      const cls = !lane.member ? 'none' : ratio > 1.001 ? 'over' : ratio >= 0.75 ? 'full' : 'ok';
                      const w = (u.end - u.start + 1) * scale.dw;
                      return (
                        <div
                          key={u.start}
                          className={`wl-cell ${cls}`}
                          style={{ left: x(u.start) + 1, width: w - 2 }}
                          title={metric === 'hours' ? `${v.toFixed(1)}h / ${cap === Infinity ? '-' : cap + 'h'}` : `${v}개 작업`}
                        >
                          {w > 26 && (metric === 'hours' ? (w > 44 ? `${Math.round(v)}h` : Math.round(v)) : v)}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {isOpen &&
                  lane.tasks.map((t) => {
                    const e = eff.get(t.id);
                    const p = projects.find((pp) => pp.id === t.projectId);
                    return (
                      <div key={t.id} className="wl-row sub">
                        <div className="wl-name sub" style={{ width: NAME_W }} onClick={() => open(t.id)}>
                          <span className="proj-dot" style={{ background: p?.color }} />
                          <span className="ellipsis">{t.name || '이름 없음'}</span>
                          {t.estimate != null && <span className="muted small">{t.estimate}h</span>}
                        </div>
                        <div className="wl-cells" style={{ width: scale.width }}>
                          {e?.start != null && e.end != null && (
                            <div
                              className="wl-task"
                              onClick={() => open(t.id)}
                              style={{ left: x(e.start), width: (e.end - e.start + 1) * scale.dw, background: t.color ?? p?.color }}
                            >
                              {t.name}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
