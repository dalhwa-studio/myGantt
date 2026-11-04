import { useState } from 'react';
import { useStore } from '../store';
import type { ID, Status, Task } from '../types';
import { matchesFilter, useTree } from '../lib/derived';
import { fmtShort, todayDay } from '../lib/date';
import { PRIORITY_LABEL, STATUSES, STATUS_COLOR, STATUS_LABEL } from '../lib/util';
import { Avatars } from './common';

export function BoardView() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const filters = useStore((s) => s.filters);
  const update = useStore((s) => s.updateTask);
  const addTask = useStore((s) => s.addTask);
  const { tree, eff, byId } = useTree();
  const [over, setOver] = useState<Status | null>(null);
  const [dragId, setDragId] = useState<ID | null>(null);
  const visibleProjects = new Set(projects.filter((p) => p.visible).map((p) => p.id));
  const cards = tasks.filter(
    (t) => visibleProjects.has(t.projectId) && t.type !== 'section' && !(tree.get(t.id) ?? []).length && matchesFilter(t, { ...filters, status: 'all' }),
  );
  const firstProject = projects.find((p) => p.visible);
  const today = todayDay();

  return (
    <div className="board">
      {STATUSES.map((st) => {
        const col = cards.filter((c) => c.status === st);
        return (
          <div
            key={st}
            className={`board-col${over === st ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(st);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/plain') || dragId;
              if (id) update(id, { status: st });
            }}
          >
            <div className="board-col-head">
              <span className="status-dot" style={{ background: STATUS_COLOR[st] }} />
              {STATUS_LABEL[st]}
              <span className="count">{col.length}</span>
            </div>
            <div className="board-cards">
              {col.map((t) => (
                <Card key={t.id} t={t} parent={t.parentId ? byId.get(t.parentId)?.name : undefined} end={eff.get(t.id)?.end ?? null} today={today} onDrag={setDragId} />
              ))}
            </div>
            {firstProject && (
              <button
                className="btn ghost sm board-add"
                onClick={() => {
                  const id = addTask({ projectId: firstProject.id, name: '새 작업' });
                  update(id, { status: st });
                  useStore.setState({ editingId: null, detailId: id });
                }}
              >
                ＋ 작업 추가
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Card({ t, parent, end, today, onDrag }: { t: Task; parent?: string; end: number | null; today: number; onDrag: (id: ID) => void }) {
  const project = useStore((s) => s.projects.find((p) => p.id === t.projectId));
  const open = useStore((s) => s.openDetail);
  const overdue = end != null && end < today && t.status !== 'done';
  return (
    <div
      className="card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id);
        onDrag(t.id);
      }}
      onClick={() => open(t.id)}
      style={{ borderLeftColor: t.color ?? project?.color }}
    >
      <div className="card-proj">
        {project?.name}
        {parent && ` / ${parent}`}
      </div>
      <div className={`card-title${t.status === 'done' ? ' done-text' : ''}`}>
        {t.type === 'milestone' && '◆ '}
        {t.name || '이름 없음'}
      </div>
      {t.progress > 0 && t.status !== 'done' && (
        <div className="card-progress">
          <div style={{ width: `${t.progress}%`, background: t.color ?? project?.color }} />
        </div>
      )}
      <div className="card-foot">
        {end != null && <span className={`card-date${overdue ? ' overdue' : ''}`}>📅 {fmtShort(end)}</span>}
        {t.priority !== 'none' && <span className={`prio ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>}
        {t.checklist.length > 0 && (
          <span className="muted small">
            ☑ {t.checklist.filter((c) => c.done).length}/{t.checklist.length}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Avatars ids={t.assignees} size={20} />
      </div>
    </div>
  );
}
