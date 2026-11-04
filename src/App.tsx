import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { useRows } from './lib/derived';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { GanttView } from './components/GanttView';
import { BoardView } from './components/BoardView';
import { WorkloadView } from './components/WorkloadView';
import { CalendarView } from './components/CalendarView';
import { TaskDetail } from './components/TaskDetail';
import { SettingsModal } from './components/SettingsModal';
import { Toaster } from './components/common';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export default function App() {
  const view = useStore((s) => s.settings.view);
  const sidebarOpen = useStore((s) => s.settings.sidebarOpen);
  const detailId = useStore((s) => s.detailId);
  const [showSettings, setShowSettings] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const rows = useRows();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTyping(e)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e) || s.settings.view !== 'gantt') return;
      const sel = s.tasks.find((t) => t.id === s.selectedId);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const taskRows = rowsRef.current.filter((r) => r.kind === 'task');
        if (!taskRows.length) return;
        e.preventDefault();
        const i = taskRows.findIndex((r) => r.kind === 'task' && r.task.id === s.selectedId);
        const n = i < 0 ? 0 : Math.max(0, Math.min(taskRows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        const r = taskRows[n];
        if (r.kind === 'task') {
          s.select(r.task.id);
          if (s.detailId) s.openDetail(r.task.id);
        }
        return;
      }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteTasks([sel.id]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        s.setEditing(sel.id);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) s.outdent(sel.id);
        else s.indent(sel.id);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.duplicateTask(sel.id);
      } else if (e.key === ' ') {
        e.preventDefault();
        s.openDetail(s.detailId === sel.id ? null : sel.id);
      } else if (e.key === 'Escape') {
        if (s.detailId) s.openDetail(null);
        else s.select(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className={`app${sidebarOpen ? '' : ' no-sidebar'}`}>
      {sidebarOpen && <Sidebar onSettings={() => setShowSettings(true)} />}
      <main className="main">
        <Toolbar exportNode={() => exportRef.current} />
        <div className="content">
          <div className="view">
            {view === 'gantt' && <GanttView exportRef={exportRef} />}
            {view === 'board' && <BoardView />}
            {view === 'workload' && <WorkloadView />}
            {view === 'calendar' && <CalendarView />}
          </div>
          {detailId && <TaskDetail />}
        </div>
      </main>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <Toaster />
    </div>
  );
}
