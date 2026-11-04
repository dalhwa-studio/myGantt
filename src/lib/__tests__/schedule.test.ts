import { describe, expect, it } from 'vitest';
import { autoSchedule, computeEffective, createsCycle, criticalTasks } from '../schedule';
import { addWorking, makeCal, toDay, workingDaysBetween, fromDay } from '../date';
import { newTask } from '../task';
import type { Dependency } from '../../types';

const t = (id: string, start: string | null, end: string | null, parentId: string | null = null) =>
  newTask({ id, projectId: 'p', parentId, start, end, name: id });

describe('date', () => {
  it('round-trips ISO dates', () => {
    expect(fromDay(toDay('2026-11-04'))).toBe('2026-11-04');
  });
  it('counts working days', () => {
    const cal = makeCal([1, 2, 3, 4, 5], [], true);
    // 2026-11-02 is Monday
    expect(workingDaysBetween(cal, toDay('2026-11-02'), toDay('2026-11-08'))).toBe(5);
    expect(fromDay(addWorking(cal, toDay('2026-11-05'), 3))).toBe('2026-11-09');
  });
});

describe('rollup', () => {
  it('parents span children', () => {
    const tasks = [t('a', null, null), t('b', '2026-01-05', '2026-01-09', 'a'), t('c', '2026-01-12', '2026-01-14', 'a')];
    const e = computeEffective(tasks).get('a')!;
    expect(fromDay(e.start!)).toBe('2026-01-05');
    expect(fromDay(e.end!)).toBe('2026-01-14');
  });
});

describe('autoSchedule', () => {
  const cal = makeCal([1, 2, 3, 4, 5], [], false);
  it('pushes FS successors forward and cascades', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-10'), t('b', '2026-01-05', '2026-01-06'), t('c', '2026-01-07', '2026-01-08')];
    const deps: Dependency[] = [
      { id: '1', from: 'a', to: 'b', type: 'FS', lag: 0 },
      { id: '2', from: 'b', to: 'c', type: 'FS', lag: 1 },
    ];
    const out = autoSchedule(tasks, deps, ['a'], cal);
    const b = out.find((x) => x.id === 'b')!;
    const c = out.find((x) => x.id === 'c')!;
    expect([b.start, b.end]).toEqual(['2026-01-11', '2026-01-12']);
    expect([c.start, c.end]).toEqual(['2026-01-14', '2026-01-15']);
  });
  it('does not pull tasks earlier', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-02'), t('b', '2026-02-01', '2026-02-02')];
    const out = autoSchedule(tasks, [{ id: '1', from: 'a', to: 'b', type: 'FS', lag: 0 }], ['a'], cal);
    expect(out[1].start).toBe('2026-02-01');
  });
  it('shifts parent successors by moving children', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-10'), t('p', null, null), t('k', '2026-01-03', '2026-01-04', 'p')];
    const out = autoSchedule(tasks, [{ id: '1', from: 'a', to: 'p', type: 'FS', lag: 0 }], ['a'], cal);
    expect(out.find((x) => x.id === 'k')!.start).toBe('2026-01-11');
  });
});

describe('graph', () => {
  it('detects cycles', () => {
    const deps: Dependency[] = [{ id: '1', from: 'a', to: 'b', type: 'FS', lag: 0 }];
    expect(createsCycle(deps, 'b', 'a')).toBe(true);
    expect(createsCycle(deps, 'a', 'c')).toBe(false);
  });
  it('finds the critical path', () => {
    const tasks = [t('a', '2026-01-01', '2026-01-05'), t('b', '2026-01-06', '2026-01-10'), t('x', '2026-01-01', '2026-01-02')];
    const deps: Dependency[] = [{ id: '1', from: 'a', to: 'b', type: 'FS', lag: 0 }];
    const crit = criticalTasks(tasks, deps, computeEffective(tasks));
    expect([...crit].sort()).toEqual(['a', 'b']);
  });
});
