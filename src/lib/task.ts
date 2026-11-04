import type { ID, Task } from '../types';
import { uid } from './util';

export function newTask(o: Partial<Task> & { projectId: ID }): Task {
  return {
    id: uid(),
    parentId: null,
    order: 0,
    name: '',
    type: 'task',
    start: null,
    end: null,
    progress: 0,
    status: 'todo',
    priority: 'none',
    assignees: [],
    color: null,
    estimate: null,
    description: '',
    checklist: [],
    comments: [],
    links: [],
    collapsed: false,
    createdAt: new Date().toISOString(),
    ...o,
  };
}

