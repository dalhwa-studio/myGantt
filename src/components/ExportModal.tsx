import { useState } from 'react';
import { exportGantt, type ExportFormat, type ExportOptions } from '../lib/exportImage';
import { Modal, toast } from './common';

const KEY = 'mygantt-export-opts';
const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: 'PDF 문서', jpg: 'JPG 이미지', png: 'PNG 이미지' };

function loadOpts(format: ExportFormat): ExportOptions {
  const base: ExportOptions = { format, range: 'tasks', title: true, pageSize: 'a4', orientation: 'landscape', fit: 'width' };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(KEY) || '{}'), format };
  } catch {
    return base;
  }
}

export function ExportModal({ format, getNode, onClose }: { format: ExportFormat; getNode: () => HTMLElement | null; onClose: () => void }) {
  const [o, setO] = useState<ExportOptions>(() => loadOpts(format));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ExportOptions>) => setO((x) => ({ ...x, ...p }));

  const run = async () => {
    setBusy(true);
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
      await exportGantt(getNode, o);
      toast(`${FORMAT_LABEL[o.format]}로 내보냈습니다`);
      onClose();
    } catch (e) {
      toast('내보내기 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="간트 차트 내보내기" onClose={onClose} width={460}>
      <div className="export-form">
        <label>형식</label>
        <div className="seg">
          {(['pdf', 'jpg', 'png'] as ExportFormat[]).map((f) => (
            <button key={f} className={o.format === f ? 'on' : ''} onClick={() => set({ format: f })}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <label>범위</label>
        <div className="seg">
          <button className={o.range === 'tasks' ? 'on' : ''} onClick={() => set({ range: 'tasks' })}>
            작업 기간만
          </button>
          <button className={o.range === 'all' ? 'on' : ''} onClick={() => set({ range: 'all' })}>
            전체 타임라인
          </button>
        </div>

        <label>제목</label>
        <label className="check-label">
          <input type="checkbox" checked={o.title} onChange={(e) => set({ title: e.target.checked })} />
          프로젝트 이름과 기간 표시
        </label>

        {o.format === 'pdf' && (
          <>
            <label>용지</label>
            <div className="row-gap">
              <div className="seg">
                {(['a4', 'a3', 'a2'] as const).map((p) => (
                  <button key={p} className={o.pageSize === p ? 'on' : ''} onClick={() => set({ pageSize: p })}>
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="seg">
                <button className={o.orientation === 'landscape' ? 'on' : ''} onClick={() => set({ orientation: 'landscape' })}>
                  가로
                </button>
                <button className={o.orientation === 'portrait' ? 'on' : ''} onClick={() => set({ orientation: 'portrait' })}>
                  세로
                </button>
              </div>
            </div>

            <label>배치</label>
            <div className="seg">
              <button className={o.fit === 'width' ? 'on' : ''} onClick={() => set({ fit: 'width' })}>
                너비 맞춤 (여러 페이지)
              </button>
              <button className={o.fit === 'page' ? 'on' : ''} onClick={() => set({ fit: 'page' })}>
                한 페이지에 맞춤
              </button>
            </div>
          </>
        )}
      </div>
      <p className="muted small">
        현재 간트 화면의 줌 단계, 펼침/접힘 상태, 필터가 그대로 반영됩니다. 글자가 너무 작으면 줌을 '월'이나 '분기'로 바꾸거나 더 큰 용지를 선택하세요.
      </p>
      <div className="export-actions">
        <button className="btn" onClick={onClose}>
          취소
        </button>
        <button className="btn primary" disabled={busy} onClick={run}>
          {busy ? '생성 중…' : `${FORMAT_LABEL[o.format]} 다운로드`}
        </button>
      </div>
    </Modal>
  );
}
