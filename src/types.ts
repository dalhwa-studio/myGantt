export type ID = string;
export type TaskType = 'task' | 'milestone' | 'section';
export type Status = 'todo' | 'inprogress' | 'review' | 'done';
export type Priority = 'none' | 'low' | 'medium' | 'high';
export type DepType = 'FS' | 'SS' | 'FF' | 'SF';
export type Zoom = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type View = 'gantt' | 'board' | 'workload' | 'calendar';

export interface Member {
  id: ID;
  name: string;
  color: string;
  /** working hours per day */
  capacity: number;
}

export interface ChecklistItem {
  id: ID;
  text: string;
  done: boolean;
}

export interface Comment {
  id: ID;
  author: ID | null;
  text: string;
  createdAt: string;
}

export interface Link {
  id: ID;
  title: string;
  url: string;
}

export interface Task {
  id: ID;
  projectId: ID;
  parentId: ID | null;
  order: number;
  name: string;
  type: TaskType;
  /** ISO date YYYY-MM-DD, inclusive */
  start: string | null;
  /** ISO date YYYY-MM-DD, inclusive */
  end: string | null;
  progress: number;
  status: Status;
  priority: Priority;
  assignees: ID[];
  color: string | null;
  /** estimated hours */
  estimate: number | null;
  description: string;
  checklist: ChecklistItem[];
  comments: Comment[];
  links: Link[];
  collapsed: boolean;
  createdAt: string;
}

export interface Dependency {
  id: ID;
  from: ID;
  to: ID;
  type: DepType;
  /** lag in days */
  lag: number;
}

export interface Baseline {
  id: ID;
  name: string;
  createdAt: string;
  snapshot: Record<ID, { start: string | null; end: string | null }>;
}

export interface Project {
  id: ID;
  name: string;
  color: string;
  order: number;
  visible: boolean;
  collapsed: boolean;
}

export interface Columns {
  assignee: boolean;
  start: boolean;
  end: boolean;
  duration: boolean;
  progress: boolean;
  status: boolean;
}

export interface Settings {
  view: View;
  zoom: Zoom;
  workingDays: number[];
  holidays: string[];
  autoSchedule: boolean;
  workingDaysOnly: boolean;
  showCritical: boolean;
  showDependencies: boolean;
  showWeekends: boolean;
  showBaseline: ID | null;
  currentUser: ID | null;
  nameWidth: number;
  columns: Columns;
  sidebarOpen: boolean;
  workloadMetric: 'hours' | 'tasks';
}

export interface Filters {
  search: string;
  assignee: ID | 'all' | 'none';
  status: Status | 'all';
  hideDone: boolean;
}

export interface Data {
  projects: Project[];
  tasks: Task[];
  deps: Dependency[];
  members: Member[];
  baselines: Baseline[];
}
