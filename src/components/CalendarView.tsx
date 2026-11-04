import { useState } from 'react';
import { useStore } from '../store';
import { matchesFilter, useCal, useTree } from '../lib/derived';
import { addMonths, fromDay, isOffDay, startOfMonth, startOfWeek, todayDay, ymd } from '../lib/date';

const WD = ['월', '화', '수', '목', '금', '토', '일'];

export function CalendarView() {
  const [month, setMonth] = useState(() => startOfMonth(todayDay()));
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const filters = useStore((s) => s.filters);
  const open = useStore((s) => s.openDetail);
  const addTask = useStore((s) => s.addTask);
  const { tree, eff } = useTree();
  const cal = useCal();
  const today = todayDay();
  const visible = new Map(projects.filter((p) => p.visible).map((p) => [p.id, p]));
  const items = tasks.filter(
    (t) => visible.has(t.projectId) && t.type !== 'section' && !(tree.get(t.id) ?? []).length && eff.get(t.id)?.start != null && matchesFilter(t, filters),
  );
  const first = startOfWeek(month);
  const next = addMonths(month, 1);
  const weeks: number[][] = [];
  for (let w = first; w < next; w += 7) weeks.push(Array.from({ length: 7 }, (_, i) => w + i));
  const { y, m } = ymd(month);

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="btn" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </button>
        <h2>
          {y}년 {m + 1}월
        </h2>
        <button className="btn" onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </button>
        <button className="btn" onClick={() => setMonth(startOfMonth(today))}>
          오늘
        </button>
      </div>
      <div className="cal-grid">
        {WD.map((d) => (
          <div key={d} className="cal-wd">
            {d}
          </div>
        ))}
        {weeks.flat().map((d) => {
          const inMonth = d >= month && d < next;
          const list = items.filter((t) => {
            const e = eff.get(t.id)!;
            return e.start! <= d && d <= e.end!;
          });
          return (
            <div key={d} className={`cal-day${inMonth ? '' : ' out'}${d === today ? ' today' : ''}${isOffDay(cal, d) ? ' off' : ''}`}>
              <div className="cal-day-head">
                <span className="cal-num">{ymd(d).d}</span>
                <button
                  className="row-add"
                  title="이 날짜에 작업 추가"
                  onClick={() => {
                    const p = [...visible.values()][0];
                    if (!p) return;
                    const id = addTask({ projectId: p.id, name: '새 작업', start: fromDay(d), end: fromDay(d) });
                    useStore.setState({ editingId: null, detailId: id });
                  }}
                >
                  ＋
                </button>
              </div>
              {list.slice(0, 4).map((t) => {
                const e = eff.get(t.id)!;
                const c = t.color ?? visible.get(t.projectId)?.color;
                const isStart = e.start === d || ymd(d).d === 1 || (d - first) % 7 === 0;
                return (
                  <div
                    key={t.id}
                    className={`cal-chip${t.type === 'milestone' ? ' ms' : ''}${t.status === 'done' ? ' done' : ''}`}
                    style={{ background: t.type === 'milestone' ? 'transparent' : c, color: t.type === 'milestone' ? c : '#fff' }}
                    onClick={() => open(t.id)}
                    title={t.name}
                  >
                    {t.type === 'milestone' ? `◆ ${t.name}` : isStart ? t.name || '이름 없음' : ' '}
                  </div>
                );
              })}
              {list.length > 4 && <div className="cal-more">+{list.length - 4}개 더</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
