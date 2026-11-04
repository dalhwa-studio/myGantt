import { useState } from 'react';
import { useStore } from '../store';
import { Avatar, ColorSwatches, Modal, toast } from './common';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const members = useStore((s) => s.members);
  const st = useStore.getState;
  const set = st().setSettings;
  const [name, setName] = useState('');
  const [holiday, setHoliday] = useState('');
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <Modal title="설정" onClose={onClose} width={620}>
      <section className="set-section">
        <h4>팀원</h4>
        <table className="member-table">
          <thead>
            <tr>
              <th />
              <th>이름</th>
              <th>용량 (시간/일)</th>
              <th>나</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <button className="plain" onClick={() => setColorFor(colorFor === m.id ? null : m.id)} title="색상 변경">
                    <Avatar m={m} size={26} />
                  </button>
                  {colorFor === m.id && (
                    <div className="inline-swatches">
                      <ColorSwatches value={m.color} onChange={(c) => c && st().updateMember(m.id, { color: c })} />
                    </div>
                  )}
                </td>
                <td>
                  <input defaultValue={m.name} onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && st().updateMember(m.id, { name: e.target.value.trim() })} />
                </td>
                <td>
                  <input type="number" min={0} max={24} value={m.capacity} onChange={(e) => st().updateMember(m.id, { capacity: Math.max(0, Number(e.target.value) || 0) })} />
                </td>
                <td>
                  <input type="radio" name="me" checked={settings.currentUser === m.id} onChange={() => set({ currentUser: m.id })} />
                </td>
                <td>
                  <button className="icon-btn sm danger" onClick={() => st().deleteMember(m.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="row-gap"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            st().addMember(name.trim());
            setName('');
          }}
        >
          <input placeholder="새 팀원 이름" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn">추가</button>
        </form>
      </section>

      <section className="set-section">
        <h4>근무일 / 일정</h4>
        <div className="row-gap">
          {WD.map((d, i) => (
            <label key={i} className="check-label">
              <input
                type="checkbox"
                checked={settings.workingDays.includes(i)}
                onChange={() =>
                  set({ workingDays: settings.workingDays.includes(i) ? settings.workingDays.filter((x) => x !== i) : [...settings.workingDays, i].sort() })
                }
              />
              {d}
            </label>
          ))}
        </div>
        <label className="check-label">
          <input type="checkbox" checked={settings.workingDaysOnly} onChange={(e) => set({ workingDaysOnly: e.target.checked })} />
          기간 계산과 자동 일정 조정 시 근무일만 사용 (주말·휴일 제외)
        </label>
        <label className="check-label">
          <input type="checkbox" checked={settings.autoSchedule} onChange={(e) => set({ autoSchedule: e.target.checked })} />
          자동 일정 조정 — 선행 작업이 늦어지면 후행 작업을 자동으로 미룹니다
        </label>
      </section>

      <section className="set-section">
        <h4>휴일</h4>
        <form
          className="row-gap"
          onSubmit={(e) => {
            e.preventDefault();
            if (!holiday || settings.holidays.includes(holiday)) return;
            set({ holidays: [...settings.holidays, holiday].sort() });
            setHoliday('');
          }}
        >
          <input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
          <button className="btn">휴일 추가</button>
        </form>
        <div className="chips">
          {settings.holidays.map((h) => (
            <span key={h} className="chip">
              {h}
              <button onClick={() => set({ holidays: settings.holidays.filter((x) => x !== h) })}>✕</button>
            </span>
          ))}
          {!settings.holidays.length && <span className="muted small">등록된 휴일이 없습니다</span>}
        </div>
      </section>

      <section className="set-section">
        <h4>데이터</h4>
        <p className="muted small">모든 데이터는 이 브라우저(localStorage)에 저장됩니다. 다른 기기와 공유하려면 내보내기 → JSON 백업을 사용하세요.</p>
        {confirmReset ? (
          <div className="row-gap">
            <span>현재 데이터를 지우고 예제 데이터로 되돌릴까요? (실행 취소 가능)</span>
            <button className="btn" onClick={() => setConfirmReset(false)}>
              취소
            </button>
            <button
              className="btn danger"
              onClick={() => {
                st().resetDemo();
                setConfirmReset(false);
                toast('예제 데이터로 초기화했습니다');
              }}
            >
              초기화
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirmReset(true)}>
            예제 데이터로 초기화
          </button>
        )}
      </section>

      <section className="set-section">
        <h4>단축키</h4>
        <ul className="shortcuts">
          <li><kbd>Enter</kbd> 선택한 작업 이름 편집 / 편집 중이면 아래에 새 작업</li>
          <li><kbd>Tab</kbd> / <kbd>⇧Tab</kbd> 들여쓰기 / 내어쓰기</li>
          <li><kbd>Delete</kbd> 선택한 작업 삭제</li>
          <li><kbd>⌘/Ctrl D</kbd> 작업 복제</li>
          <li><kbd>⌘/Ctrl Z</kbd> 실행 취소, <kbd>⇧⌘Z</kbd> / <kbd>Ctrl Y</kbd> 다시 실행</li>
          <li><kbd>↑</kbd> <kbd>↓</kbd> 작업 선택 이동, <kbd>Space</kbd> 상세 열기</li>
          <li>막대 끝의 점을 다른 막대로 드래그하면 의존성이 생성됩니다</li>
        </ul>
      </section>
    </Modal>
  );
}
