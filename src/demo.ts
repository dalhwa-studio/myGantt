import type { Data, Dependency, Task } from './types';
import { addWorking, fromDay, makeCal, nextWorking, startOfWeek, todayDay } from './lib/date';
import { newTask } from './lib/task';
import { autoSchedule } from './lib/schedule';

export function demoData(): Data {
  const cal = makeCal([1, 2, 3, 4, 5], [], true);
  const base = startOfWeek(todayDay()) - 7;
  const members = [
    { id: 'm1', name: '김지민', color: '#4f46e5', capacity: 8 },
    { id: 'm2', name: '이서준', color: '#10b981', capacity: 8 },
    { id: 'm3', name: '박하은', color: '#f59e0b', capacity: 6 },
  ];
  const projects = [
    { id: 'p1', name: '웹사이트 리뉴얼', color: '#4f46e5', order: 0, visible: true, collapsed: false },
    { id: 'p2', name: '마케팅 캠페인', color: '#ec4899', order: 1, visible: true, collapsed: false },
  ];
  const tasks: Task[] = [];
  const order = new Map<string, number>();
  const add = (
    id: string,
    projectId: string,
    parentId: string | null,
    name: string,
    off: number | null,
    dur: number,
    extra: Partial<Task> = {},
  ) => {
    const k = parentId ?? projectId;
    const o = order.get(k) ?? 0;
    order.set(k, o + 1);
    let start: string | null = null;
    let end: string | null = null;
    if (off != null) {
      const s = nextWorking(cal, base + off);
      start = fromDay(s);
      end = fromDay(extra.type === 'milestone' ? s : addWorking(cal, s, dur));
    }
    tasks.push(newTask({ id, projectId, parentId, name, start, end, order: o, ...extra }));
  };

  add('s1', 'p1', null, '기획', null, 0, { type: 'section' });
  add('t1', 'p1', 's1', '요구사항 수집', 0, 4, { assignees: ['m1'], status: 'done', progress: 100, estimate: 24 });
  add('t2', 'p1', 's1', '사이트맵 & 정보구조', 4, 3, { assignees: ['m1', 'm3'], status: 'inprogress', progress: 60, estimate: 20 });
  add('t3', 'p1', 's1', '기획 승인', 7, 1, { type: 'milestone' });
  add('s2', 'p1', null, '디자인', null, 0, { type: 'section' });
  add('t4', 'p1', 's2', '와이어프레임', 8, 4, { assignees: ['m3'], status: 'todo', estimate: 28, color: '#f59e0b' });
  add('t5', 'p1', 's2', 'UI 디자인', 14, 6, { assignees: ['m3'], estimate: 40, color: '#f59e0b' });
  add('t5a', 'p1', 't5', '메인 페이지', 14, 3, { assignees: ['m3'], estimate: 18, color: '#f59e0b' });
  add('t5b', 'p1', 't5', '서브 페이지', 17, 3, { assignees: ['m3'], estimate: 18, color: '#f59e0b' });
  add('s3', 'p1', null, '개발', null, 0, { type: 'section' });
  add('t6', 'p1', 's3', '프론트엔드 개발', 21, 10, { assignees: ['m2'], estimate: 70, priority: 'high' });
  add('t7', 'p1', 's3', 'CMS 연동', 23, 6, { assignees: ['m2', 'm1'], estimate: 36 });
  add('t8', 'p1', 's3', 'QA 테스트', 35, 4, { assignees: ['m1'], estimate: 24 });
  add('t9', 'p1', null, '런칭', 39, 1, { type: 'milestone', priority: 'high' });

  add('c1', 'p2', null, '캠페인 전략 수립', 2, 3, { assignees: ['m1'], status: 'inprogress', progress: 30, estimate: 16 });
  add('c2', 'p2', null, '콘텐츠 제작', 7, 8, { assignees: ['m3'], estimate: 40 });
  add('c3', 'p2', null, '광고 집행', 21, 15, { assignees: ['m2'], estimate: 30 });

  const deps: Dependency[] = [
    { id: 'd1', from: 't1', to: 't2', type: 'FS', lag: 0 },
    { id: 'd2', from: 't2', to: 't3', type: 'FS', lag: 0 },
    { id: 'd3', from: 't3', to: 't4', type: 'FS', lag: 0 },
    { id: 'd4', from: 't4', to: 't5a', type: 'FS', lag: 0 },
    { id: 'd5', from: 't5a', to: 't5b', type: 'FS', lag: 0 },
    { id: 'd6', from: 't5b', to: 't6', type: 'FS', lag: 0 },
    { id: 'd7', from: 't6', to: 't7', type: 'SS', lag: 2 },
    { id: 'd8', from: 't6', to: 't8', type: 'FS', lag: 0 },
    { id: 'd9', from: 't8', to: 't9', type: 'FS', lag: 0 },
    { id: 'd10', from: 'c1', to: 'c2', type: 'FS', lag: 0 },
  ];
  const scheduled = autoSchedule(tasks, deps, tasks.map((t) => t.id), cal);
  return { projects, tasks: scheduled, deps, members, baselines: [] };
}
