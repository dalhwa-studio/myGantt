import { toCanvas } from 'html-to-image';
import { useStore } from '../store';
import { ROW_H, ZOOM_DW } from './derived';
import { buildTree, computeEffective } from './schedule';
import { fmtLong, startOfMonth, startOfQuarter, startOfWeek, startOfYear, todayDay, type Day } from './date';

export type ExportFormat = 'png' | 'jpg' | 'pdf';
export interface ExportOptions {
  format: ExportFormat;
  /** tasks: only the span covered by tasks; all: the whole timeline */
  range: 'tasks' | 'all';
  title: boolean;
  pageSize: 'a4' | 'a3' | 'a2';
  orientation: 'landscape' | 'portrait';
  /** width: fit page width, paginate vertically; page: whole chart on one page */
  fit: 'width' | 'page';
}

export const HEAD_H = 52;
const TITLE_H = 48;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const stamp = () => new Date().toISOString().slice(0, 10);

function visibleTaskSpan(): { start: Day; end: Day } | null {
  const s = useStore.getState();
  const visible = new Set(s.projects.filter((p) => p.visible).map((p) => p.id));
  const tasks = s.tasks.filter((t) => visible.has(t.projectId));
  const eff = computeEffective(tasks, buildTree(tasks));
  let a = Infinity;
  let b = -Infinity;
  for (const e of eff.values()) {
    if (e.start == null || e.end == null) continue;
    a = Math.min(a, e.start);
    b = Math.max(b, e.end);
  }
  if (a === Infinity) return null;
  return { start: a, end: b };
}

/** Timeline range used for export: task span, aligned to the zoom's units, with room for labels. */
function exportRange(): { start: Day; end: Day } | null {
  const span = visibleTaskSpan();
  if (!span) return null;
  const zoom = useStore.getState().settings.zoom;
  const dw = ZOOM_DW[zoom];
  const labelDays = Math.ceil(240 / dw);
  let start: Day;
  switch (zoom) {
    case 'day':
      start = span.start - 2;
      break;
    case 'week':
      start = startOfWeek(span.start - 3);
      break;
    case 'month':
      start = startOfMonth(span.start);
      break;
    case 'quarter':
      start = startOfQuarter(span.start);
      break;
    default:
      start = startOfYear(span.start);
  }
  return { start, end: span.end + labelDays };
}

function exportTitle(): string {
  const s = useStore.getState();
  const names = s.projects.filter((p) => p.visible).sort((a, b) => a.order - b.order).map((p) => p.name);
  const span = visibleTaskSpan();
  const period = span ? `${fmtLong(span.start)} – ${fmtLong(span.end)}` : '';
  return [names.join(', ') || 'myGantt', period].filter(Boolean).join('   ·   ');
}

/** Render the Gantt chart (grid + timeline) into a canvas. */
async function captureGantt(getNode: () => HTMLElement | null, opts: ExportOptions) {
  const s = useStore.getState();
  const prevSel = s.selectedId;
  if (s.settings.view !== 'gantt') {
    s.setSettings({ view: 'gantt' });
    await nextFrame();
  }
  const range = opts.range === 'tasks' ? exportRange() : null;
  useStore.setState({ exportRange: range, exporting: true, selectedId: null });
  await nextFrame();
  try {
    const node = getNode();
    if (!node) throw new Error('간트 차트를 찾을 수 없습니다');
    await document.fonts?.ready;
    const w = node.scrollWidth;
    const h = node.scrollHeight;
    // stay inside browser canvas limits
    const ratio = Math.max(0.25, Math.min(2, 16000 / w, 16000 / h, Math.sqrt(160e6 / (w * h))));
    const chart = await toCanvas(node, {
      backgroundColor: '#ffffff',
      width: w,
      height: h,
      pixelRatio: ratio,
      filter: (n) => !(n instanceof HTMLElement && n.classList.contains('add-row')),
    });
    if (!opts.title) return { canvas: chart, ratio, headerPx: HEAD_H * ratio };
    // prepend a title band
    const titleH = Math.round(TITLE_H * ratio);
    const out = document.createElement('canvas');
    out.width = chart.width;
    out.height = chart.height + titleH;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    const font = getComputedStyle(document.documentElement).fontFamily;
    ctx.fillStyle = '#1f2433';
    ctx.font = `700 ${Math.round(17 * ratio)}px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(exportTitle(), 16 * ratio, titleH / 2);
    ctx.fillStyle = '#7a8194';
    ctx.font = `${Math.round(12 * ratio)}px ${font}`;
    ctx.textAlign = 'right';
    ctx.fillText(`myGantt · ${fmtLong(todayDay())}`, out.width - 16 * ratio, titleH / 2);
    ctx.drawImage(chart, 0, titleH);
    return { canvas: out, ratio, headerPx: titleH + HEAD_H * ratio };
  } finally {
    useStore.setState({ exportRange: null, exporting: false, selectedId: prevSel });
  }
}

function saveCanvas(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', filename: string) {
  return new Promise<void>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('이미지를 만들 수 없습니다 (차트가 너무 큽니다)'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve();
      },
      type,
      0.92,
    );
  });
}

async function savePDF(canvas: HTMLCanvasElement, ratio: number, headerPx: number, opts: ExportOptions) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: opts.orientation, unit: 'mm', format: opts.pageSize, compress: true });
  const margin = 8;
  const pw = pdf.internal.pageSize.getWidth() - margin * 2;
  const ph = pdf.internal.pageSize.getHeight() - margin * 2;
  const W = canvas.width;
  const H = canvas.height;

  if (opts.fit === 'page') {
    const k = Math.min(pw / W, ph / H);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, W * k, H * k);
  } else {
    const k = pw / W; // mm per px
    const pagePx = ph / k;
    const rowPx = ROW_H * ratio;
    const rowsPerPage = Math.max(1, Math.floor((pagePx - headerPx) / rowPx));
    const sliceMax = rowsPerPage * rowPx;
    let y = headerPx;
    let first = true;
    while (y < H - 1) {
      const slice = Math.min(sliceMax, H - y);
      const page = document.createElement('canvas');
      page.width = W;
      page.height = Math.ceil(headerPx + slice);
      const ctx = page.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, page.width, page.height);
      ctx.drawImage(canvas, 0, 0, W, headerPx, 0, 0, W, headerPx); // repeat header on every page
      ctx.drawImage(canvas, 0, y, W, slice, 0, headerPx, W, slice);
      if (!first) pdf.addPage(opts.pageSize, opts.orientation);
      pdf.addImage(page.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, W * k, page.height * k);
      first = false;
      y += slice;
    }
  }
  pdf.save(`mygantt-${stamp()}.pdf`);
}

export async function exportGantt(getNode: () => HTMLElement | null, opts: ExportOptions) {
  const { canvas, ratio, headerPx } = await captureGantt(getNode, opts);
  if (opts.format === 'png') return saveCanvas(canvas, 'image/png', `mygantt-${stamp()}.png`);
  if (opts.format === 'jpg') return saveCanvas(canvas, 'image/jpeg', `mygantt-${stamp()}.jpg`);
  return savePDF(canvas, ratio, headerPx, opts);
}
