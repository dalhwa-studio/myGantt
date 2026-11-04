import { useState } from 'react';
import { useStore } from '../store';
import type { Columns, Status, View, Zoom } from '../types';
import { ZOOM_LABEL, filtersActive } from '../lib/derived';
import { STATUSES, STATUS_LABEL, pickFile } from '../lib/util';
import { exportCSV, exportJSON, exportPNG, importCSV, importJSON, printPDF } from '../lib/io';
import { Dropdown, Menu, toast } from './common';

const VIEWS: { v: View; label: string; icon: string }[] = [
  { v: 'gantt', label: '간트', icon: '▤' },
  { v: 'board', label: '보드', icon: '▥' },
  { v: 'workload', label: '워크로드', icon: '▦' },
  { v: 'calendar', label: '캘린더', icon: '▣' },
];
const COL_LABEL: Record<keyof Columns, string> = {
  assignee: '담당자',
  start: '시작일',
  end: '마감일',
  duration: '기간',
  progress: '진행률',
  status: '상태',
};

export function Toolbar({ exportNode }: { exportNode: () => HTMLElement | null }) {
  const settings = useStore((s) => s.settings);
  const filters = useStore((s) => s.filters);
  const members = useStore((s) => s.members);
  const baselines = useStore((s) => s.baselines);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState;
  const set = st().setSettings;
  const [blName, setBlName] = useState('');

  const addTask = () => {
    const s = st();
    const sel = s.tasks.find((t) => t.id === s.selectedId);
    if (sel) s.addTask({ projectId: sel.projectId, afterId: sel.id });
    else {
      const p = s.projects.filter((x) => x.visible).sort((a, b) => a.order - b.order)[0];
      if (!p) return toast('먼저 프로젝트를 만들어 주세요');
      s.addTask({ projectId: p.id });
    }
    if (s.settings.view !== 'gantt') s.setSettings({ view: 'gantt' });
  };

  return (
    <header className="toolbar">
      <button className="icon-btn" title="사이드바" onClick={() => set({ sidebarOpen: !settings.sidebarOpen })}>
        ☰
      </button>
      <div className="tabs">
        {VIEWS.map((x) => (
          <button key={x.v} className={`tab${settings.view === x.v ? ' on' : ''}`} onClick={() => set({ view: x.v })}>
            <span className="tab-icon">{x.icon}</span>
            {x.label}
          </button>
        ))}
      </div>

      <button className="btn primary" onClick={addTask}>
        ＋ 작업
      </button>

      {(settings.view === 'gantt' || settings.view === 'workload') && (
        <>
          <div className="seg zoom">
            {(Object.keys(ZOOM_LABEL) as Zoom[]).map((z) => (
              <button key={z} className={settings.zoom === z ? 'on' : ''} onClick={() => set({ zoom: z })}>
                {ZOOM_LABEL[z]}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => window.dispatchEvent(new Event('mygantt:today'))}>
            오늘
          </button>
        </>
      )}

      <div className="spacer" />

      <div className="search">
        <input placeholder="🔍 작업 검색" value={filters.search} onChange={(e) => st().setFilters({ search: e.target.value })} />
      </div>

      <Dropdown className={`btn${filtersActive(filters) ? ' active' : ''}`} button="필터" align="right">
        {() => (
          <div className="filter-pop">
            <label>
              담당자
              <select value={filters.assignee} onChange={(e) => st().setFilters({ assignee: e.target.value })}>
                <option value="all">전체</option>
                <option value="none">미지정</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              상태
              <select value={filters.status} onChange={(e) => st().setFilters({ status: e.target.value as Status | 'all' })}>
                <option value="all">전체</option>
                {STATUSES.map((x) => (
                  <option key={x} value={x}>
                    {STATUS_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input type="checkbox" checked={filters.hideDone} onChange={(e) => st().setFilters({ hideDone: e.target.checked })} />
              완료된 작업 숨기기
            </label>
            {settings.currentUser && (
              <button className="btn sm" onClick={() => st().setFilters({ assignee: settings.currentUser! })}>
                내 작업만 보기
              </button>
            )}
            <button className="btn sm" onClick={() => st().setFilters({ search: '', assignee: 'all', status: 'all', hideDone: false })}>
              필터 초기화
            </button>
          </div>
        )}
      </Dropdown>

      {settings.view === 'gantt' && (
        <Dropdown className="btn" button="보기" align="right">
          {(close) => (
            <div>
              <Menu
                onClose={() => {}}
                items={[
                  { label: '크리티컬 패스 표시', checked: settings.showCritical, onClick: () => set({ showCritical: !settings.showCritical }) },
                  { label: '의존성 화살표 표시', checked: settings.showDependencies, onClick: () => set({ showDependencies: !settings.showDependencies }) },
                  { label: '주말/휴일 음영', checked: settings.showWeekends, onClick: () => set({ showWeekends: !settings.showWeekends }) },
                  { label: '자동 일정 조정', checked: settings.autoSchedule, onClick: () => set({ autoSchedule: !settings.autoSchedule }) },
                  { divider: true },
                  { label: '모두 펼치기', onClick: () => { st().setCollapsedAll(false); close(); } },
                  { label: '모두 접기', onClick: () => { st().setCollapsedAll(true); close(); } },
                  { divider: true },
                ]}
              />
              <div className="menu-sub">
                <div className="muted small">표시할 열</div>
                {(Object.keys(COL_LABEL) as (keyof Columns)[]).map((k) => (
                  <label key={k} className="check-label">
                    <input type="checkbox" checked={settings.columns[k]} onChange={() => set({ columns: { ...settings.columns, [k]: !settings.columns[k] } })} />
                    {COL_LABEL[k]}
                  </label>
                ))}
              </div>
            </div>
          )}
        </Dropdown>
      )}

      {settings.view === 'gantt' && (
        <Dropdown className={`btn${settings.showBaseline ? ' active' : ''}`} button="베이스라인" align="right">
          {(close) => (
            <div className="baseline-pop">
              <div className="muted small">현재 일정을 저장해 두고 실제 진행과 비교합니다.</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  st().saveBaseline(blName.trim() || `베이스라인 ${new Date().toLocaleDateString('ko-KR')}`);
                  setBlName('');
                  toast('베이스라인을 저장했습니다');
                  close();
                }}
              >
                <input placeholder="베이스라인 이름" value={blName} onChange={(e) => setBlName(e.target.value)} />
                <button className="btn primary sm">저장</button>
              </form>
              <Menu
                onClose={() => {}}
                items={[
                  { label: '표시 안 함', checked: !settings.showBaseline, onClick: () => set({ showBaseline: null }) },
                  ...baselines.map((b) => ({
                    label: b.name,
                    hint: new Date(b.createdAt).toLocaleDateString('ko-KR'),
                    checked: settings.showBaseline === b.id,
                    onClick: () => set({ showBaseline: b.id }),
                  })),
                ]}
              />
              {settings.showBaseline && (
                <button className="btn danger sm" onClick={() => st().deleteBaseline(settings.showBaseline!)}>
                  선택한 베이스라인 삭제
                </button>
              )}
            </div>
          )}
        </Dropdown>
      )}

      <button className="icon-btn" title="실행 취소 (⌘Z)" disabled={!canUndo} onClick={() => st().undo()}>
        ↶
      </button>
      <button className="icon-btn" title="다시 실행 (⇧⌘Z)" disabled={!canRedo} onClick={() => st().redo()}>
        ↷
      </button>

      <Dropdown className="btn" button="내보내기" align="right">
        {(close) => (
          <Menu
            onClose={close}
            items={[
              {
                label: 'PNG 이미지',
                onClick: () => {
                  if (settings.view !== 'gantt') return toast('간트 보기에서 사용할 수 있습니다');
                  toast('이미지를 생성 중입니다...');
                  exportPNG(exportNode()).catch((e) => toast(String(e.message ?? e)));
                },
              },
              { label: 'PDF / 인쇄', onClick: () => setTimeout(printPDF, 50) },
              { label: 'CSV (엑셀)', onClick: exportCSV },
              { label: 'JSON 백업', onClick: exportJSON },
              { divider: true },
              {
                label: 'CSV 가져오기',
                onClick: () =>
                  pickFile('.csv,text/csv')
                    .then((t) => toast(`${importCSV(t)}개 작업을 가져왔습니다`))
                    .catch((e) => e.message !== 'no file' && toast('가져오기 실패: ' + e.message)),
              },
              {
                label: 'JSON 가져오기 (추가)',
                onClick: () =>
                  pickFile('.json,application/json')
                    .then((t) => {
                      importJSON(t, 'merge');
                      toast('가져왔습니다');
                    })
                    .catch((e) => e.message !== 'no file' && toast('가져오기 실패: ' + e.message)),
              },
              {
                label: 'JSON 복원 (전체 교체)',
                danger: true,
                onClick: () =>
                  pickFile('.json,application/json')
                    .then((t) => {
                      importJSON(t, 'replace');
                      toast('복원했습니다 (실행 취소 가능)');
                    })
                    .catch((e) => e.message !== 'no file' && toast('가져오기 실패: ' + e.message)),
              },
            ]}
          />
        )}
      </Dropdown>
    </header>
  );
}
