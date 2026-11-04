import { useState } from 'react';
import { useStore } from '../store';
import type { ID } from '../types';
import { ColorSwatches, Dropdown, Menu } from './common';

export function Sidebar({ onSettings }: { onSettings: () => void }) {
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const addProject = useStore((s) => s.addProject);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const [editing, setEditing] = useState<ID | null>(null);
  const [confirmDel, setConfirmDel] = useState<ID | null>(null);
  const sorted = [...projects].sort((a, b) => a.order - b.order);
  const allVisible = projects.every((p) => p.visible);

  return (
    <nav className="sidebar">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="7" fill="#4f46e5" />
          <rect x="6" y="8" width="12" height="4" rx="2" fill="#fff" />
          <rect x="11" y="14" width="14" height="4" rx="2" fill="#c7d2fe" />
          <rect x="8" y="20" width="9" height="4" rx="2" fill="#fff" />
        </svg>
        <span>myGantt</span>
      </div>

      <div className="side-section">
        <div className="side-title">
          프로젝트
          <button
            className="link-btn"
            title={allVisible ? '모두 숨기기' : '모두 보기'}
            onClick={() => projects.forEach((p) => updateProject(p.id, { visible: !allVisible }, false))}
          >
            {allVisible ? '모두 숨김' : '모두 보기'}
          </button>
        </div>
        {sorted.map((p) => {
          const count = tasks.filter((t) => t.projectId === p.id && t.type !== 'section').length;
          const done = tasks.filter((t) => t.projectId === p.id && t.type !== 'section' && t.status === 'done').length;
          return (
            <div key={p.id} className={`proj-item${p.visible ? ' on' : ''}`}>
              <input type="checkbox" checked={p.visible} onChange={() => updateProject(p.id, { visible: !p.visible }, false)} style={{ accentColor: p.color }} />
              {editing === p.id ? (
                <input
                  autoFocus
                  className="proj-edit"
                  defaultValue={p.name}
                  onBlur={(e) => {
                    updateProject(p.id, { name: e.target.value.trim() || p.name });
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <span
                  className="proj-label"
                  onClick={() => {
                    // solo this project
                    projects.forEach((x) => updateProject(x.id, { visible: x.id === p.id }, false));
                  }}
                  onDoubleClick={() => setEditing(p.id)}
                  title="클릭: 이 프로젝트만 보기 · 더블클릭: 이름 변경"
                >
                  {p.name}
                </span>
              )}
              <span className="proj-count" title={`${done}/${count} 완료`}>
                {count ? Math.round((done / count) * 100) : 0}%
              </span>
              <Dropdown className="icon-btn sm proj-more" button="⋯" align="right">
                {(close) =>
                  confirmDel === p.id ? (
                    <div className="confirm">
                      <p>
                        <b>{p.name}</b> 프로젝트와 모든 작업을 삭제할까요?
                      </p>
                      <div className="row-gap">
                        <button className="btn" onClick={() => { setConfirmDel(null); close(); }}>
                          취소
                        </button>
                        <button className="btn danger" onClick={() => { deleteProject(p.id); setConfirmDel(null); close(); }}>
                          삭제
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Menu
                        onClose={() => {}}
                        items={[
                          { label: '이름 변경', onClick: () => { setEditing(p.id); close(); } },
                          { label: '작업 추가', onClick: () => { useStore.getState().addTask({ projectId: p.id }); close(); } },
                          { label: '섹션 추가', onClick: () => { useStore.getState().addTask({ projectId: p.id, type: 'section', name: '새 섹션' }); close(); } },
                        ]}
                      />
                      <div className="menu-sub">
                        <div className="muted small">색상</div>
                        <ColorSwatches value={p.color} onChange={(c) => c && updateProject(p.id, { color: c })} />
                      </div>
                      <Menu onClose={() => {}} items={[{ divider: true }, { label: '프로젝트 삭제', danger: true, onClick: () => setConfirmDel(p.id) }]} />
                    </div>
                  )
                }
              </Dropdown>
            </div>
          );
        })}
        <button
          className="btn ghost add-proj"
          onClick={() => {
            const id = addProject();
            setEditing(id);
          }}
        >
          ＋ 새 프로젝트
        </button>
      </div>

      <div className="side-foot">
        <button className="btn ghost" onClick={onSettings}>
          ⚙ 설정 · 팀원
        </button>
        <div className="muted small">데이터는 이 브라우저에 자동 저장됩니다</div>
      </div>
    </nav>
  );
}
