import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { DepType, Priority, Status, Task, TaskType } from '../types';
import { useCal, useTree } from '../lib/derived';
import { addWorking, fromDay, toDay, todayDay, workingDaysBetween } from '../lib/date';
import { PRIORITY_LABEL, STATUSES, STATUS_COLOR, STATUS_LABEL, uid } from '../lib/util';
import { Avatar, Avatars, ColorSwatches, Dropdown, MemberPicker } from './common';

const DEP_LABEL: Record<DepType, string> = { FS: '완료→시작', SS: '시작→시작', FF: '완료→완료', SF: '시작→완료' };

export function TaskDetail() {
  const id = useStore((s) => s.detailId);
  const task = useStore((s) => s.tasks.find((t) => t.id === id));
  const close = () => useStore.getState().openDetail(null);
  useEffect(() => {
    if (id && !task) close();
  }, [id, task]);
  if (!task) return null;
  return <DetailInner key={task.id} task={task} onClose={close} />;
}

function DetailInner({ task, onClose }: { task: Task; onClose: () => void }) {
  const s = useStore.getState;
  const update = (p: Partial<Task>) => s().updateTask(task.id, p);
  const projects = useStore((x) => x.projects);
  const tasks = useStore((x) => x.tasks);
  const deps = useStore((x) => x.deps);
  const members = useStore((x) => x.members);
  const currentUser = useStore((x) => x.settings.currentUser);
  const { eff, tree, byId } = useTree();
  const cal = useCal();
  const e = eff.get(task.id);
  const isParent = !!e?.hasChildren;
  const [name, setName] = useState(task.name);
  const [desc, setDesc] = useState(task.description);
  const [comment, setComment] = useState('');
  const [check, setCheck] = useState('');
  const [link, setLink] = useState('');
  useEffect(() => setName(task.name), [task.name]);
  useEffect(() => setDesc(task.description), [task.description]);

  const preds = deps.filter((d) => d.to === task.id);
  const succs = deps.filter((d) => d.from === task.id);
  const subtasks = tree.get(task.id) ?? [];
  const pathNames = [] as string[];
  let cur = task.parentId;
  while (cur) {
    const p = byId.get(cur);
    if (!p) break;
    pathNames.unshift(p.name);
    cur = p.parentId;
  }
  const project = projects.find((p) => p.id === task.projectId);
  const dur = e?.start != null && e.end != null ? workingDaysBetween(cal, e.start, e.end) : null;
  const candidates = tasks.filter((t) => t.id !== task.id && !preds.some((d) => d.from === t.id));

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="crumbs">
          <span className="proj-dot" style={{ background: project?.color }} />
          {project?.name}
          {pathNames.map((n, i) => (
            <span key={i}> / {n}</span>
          ))}
        </div>
        <div className="detail-actions">
          <button className="icon-btn" title="간트에서 보기" onClick={() => window.dispatchEvent(new CustomEvent('mygantt:goto', { detail: task.id }))}>
            ⌖
          </button>
          <button className="icon-btn" title="복제" onClick={() => s().duplicateTask(task.id)}>
            ⧉
          </button>
          <button className="icon-btn danger" title="삭제" onClick={() => s().deleteTasks([task.id])}>
            🗑
          </button>
          <button className="icon-btn" title="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-title-row">
          {task.type !== 'section' && (
            <button
              className={`check big${task.status === 'done' ? ' done' : ''}`}
              onClick={() => update({ status: task.status === 'done' ? 'todo' : 'done' })}
            >
              {task.status === 'done' ? '✓' : ''}
            </button>
          )}
          <textarea
            className="detail-title"
            rows={1}
            value={name}
            placeholder="작업 이름"
            onChange={(ev) => setName(ev.target.value)}
            onBlur={() => name !== task.name && update({ name })}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                (ev.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </div>

        <div className="fields">
          <label>유형</label>
          <div className="seg">
            {(['task', 'milestone', 'section'] as TaskType[]).map((t) => (
              <button key={t} className={task.type === t ? 'on' : ''} onClick={() => update({ type: t })}>
                {t === 'task' ? '작업' : t === 'milestone' ? '◆ 마일스톤' : '섹션'}
              </button>
            ))}
          </div>

          <label>상태</label>
          <div className="seg">
            {STATUSES.map((st) => (
              <button
                key={st}
                className={task.status === st ? 'on' : ''}
                style={task.status === st ? { background: STATUS_COLOR[st], color: '#fff', borderColor: STATUS_COLOR[st] } : undefined}
                onClick={() => update({ status: st as Status })}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
          </div>

          <label>담당자</label>
          <div>
            <Dropdown className="btn ghost" button={task.assignees.length ? <Avatars ids={task.assignees} max={6} /> : <span className="muted">＋ 담당자 지정</span>}>
              {() => <MemberPicker value={task.assignees} onChange={(a) => update({ assignees: a })} />}
            </Dropdown>
          </div>

          <label>날짜</label>
          {isParent ? (
            <div className="muted">
              {e?.start != null ? `${fromDay(e.start)} → ${fromDay(e.end!)} (${dur}일, 하위 작업 기준)` : '하위 작업에 날짜가 없습니다'}
            </div>
          ) : task.type === 'section' ? (
            <div className="muted">섹션은 하위 작업의 날짜로 계산됩니다</div>
          ) : (
            <div className="date-row">
              <input
                type="date"
                value={task.start ?? ''}
                onChange={(ev) => {
                  const v = ev.target.value || null;
                  if (!v) return s().setTaskRange(task.id, null, null);
                  const len = task.start && task.end ? toDay(task.end) - toDay(task.start) : 0;
                  s().setTaskRange(task.id, v, fromDay(toDay(v) + len));
                }}
              />
              {task.type !== 'milestone' && (
                <>
                  <span>→</span>
                  <input type="date" value={task.end ?? ''} min={task.start ?? undefined} onChange={(ev) => ev.target.value && s().setTaskRange(task.id, task.start ?? ev.target.value, ev.target.value)} />
                  <input
                    type="number"
                    className="dur"
                    min={1}
                    value={dur ?? ''}
                    title="기간 (일)"
                    onChange={(ev) => {
                      const n = Math.max(1, Number(ev.target.value) || 1);
                      const st0 = task.start ? toDay(task.start) : todayDay();
                      s().setTaskRange(task.id, fromDay(st0), fromDay(addWorking(cal, st0, n)));
                    }}
                  />
                  <span className="muted">일</span>
                </>
              )}
            </div>
          )}

          {task.type !== 'section' && !isParent && (
            <>
              <label>진행률</label>
              <div className="progress-row">
                <input type="range" min={0} max={100} step={5} value={task.progress} onChange={(ev) => update({ progress: Number(ev.target.value) })} />
                <span>{task.progress}%</span>
              </div>
            </>
          )}

          <label>우선순위</label>
          <select value={task.priority} onChange={(ev) => update({ priority: ev.target.value as Priority })}>
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>

          <label>예상 시간</label>
          <div className="date-row">
            <input
              type="number"
              min={0}
              className="dur"
              value={task.estimate ?? ''}
              placeholder="-"
              onChange={(ev) => update({ estimate: ev.target.value === '' ? null : Math.max(0, Number(ev.target.value)) })}
            />
            <span className="muted">시간</span>
          </div>

          <label>색상</label>
          <ColorSwatches value={task.color} onChange={(c) => update({ color: c })} allowNone />

          <label>프로젝트</label>
          <select value={task.projectId} onChange={(ev) => s().moveTaskToProject(task.id, ev.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <section>
          <h4>설명</h4>
          <textarea
            className="desc"
            value={desc}
            placeholder="작업에 대한 설명을 추가하세요..."
            onChange={(ev) => setDesc(ev.target.value)}
            onBlur={() => desc !== task.description && update({ description: desc })}
          />
        </section>

        <section>
          <h4>
            하위 작업 <span className="count">{subtasks.length}</span>
          </h4>
          {subtasks.map((st) => (
            <div key={st.id} className="sub-row" onClick={() => s().openDetail(st.id)}>
              <span className={`check sm${st.status === 'done' ? ' done' : ''}`}>{st.status === 'done' ? '✓' : ''}</span>
              <span className={st.status === 'done' ? 'done-text' : ''}>{st.name || '이름 없음'}</span>
              <Avatars ids={st.assignees} size={18} />
            </div>
          ))}
          {task.type !== 'milestone' && (
            <button className="btn ghost sm" onClick={() => s().addTask({ projectId: task.projectId, parentId: task.id })}>
              ＋ 하위 작업 추가
            </button>
          )}
        </section>

        <section>
          <h4>
            체크리스트{' '}
            {task.checklist.length > 0 && (
              <span className="count">
                {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
              </span>
            )}
          </h4>
          {task.checklist.map((c) => (
            <div key={c.id} className="check-row">
              <input
                type="checkbox"
                checked={c.done}
                onChange={() => update({ checklist: task.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })}
              />
              <span className={c.done ? 'done-text' : ''}>{c.text}</span>
              <button className="icon-btn sm" onClick={() => update({ checklist: task.checklist.filter((x) => x.id !== c.id) })}>
                ✕
              </button>
            </div>
          ))}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!check.trim()) return;
              update({ checklist: [...task.checklist, { id: uid(), text: check.trim(), done: false }] });
              setCheck('');
            }}
          >
            <input className="inline-input" placeholder="＋ 항목 추가" value={check} onChange={(ev) => setCheck(ev.target.value)} />
          </form>
        </section>

        <section>
          <h4>의존성</h4>
          <div className="dep-list">
            {preds.map((d) => (
              <div key={d.id} className="dep-row">
                <span className="dep-dir">선행</span>
                <span className="dep-name" onClick={() => s().openDetail(d.from)}>
                  {byId.get(d.from)?.name || '이름 없음'}
                </span>
                <select value={d.type} onChange={(ev) => s().updateDependency(d.id, { type: ev.target.value as DepType })}>
                  {(Object.keys(DEP_LABEL) as DepType[]).map((k) => (
                    <option key={k} value={k}>
                      {DEP_LABEL[k]}
                    </option>
                  ))}
                </select>
                <input type="number" className="lag" title="지연(일)" value={d.lag} onChange={(ev) => s().updateDependency(d.id, { lag: Number(ev.target.value) || 0 })} />
                <button className="icon-btn sm" onClick={() => s().deleteDependency(d.id)}>
                  ✕
                </button>
              </div>
            ))}
            {succs.map((d) => (
              <div key={d.id} className="dep-row">
                <span className="dep-dir succ">후행</span>
                <span className="dep-name" onClick={() => s().openDetail(d.to)}>
                  {byId.get(d.to)?.name || '이름 없음'}
                </span>
                <span className="muted">{DEP_LABEL[d.type]}</span>
                <button className="icon-btn sm" onClick={() => s().deleteDependency(d.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <select
            className="add-dep"
            value=""
            onChange={(ev) => {
              if (ev.target.value && !s().addDependency(ev.target.value, task.id, 'FS')) alertCycle();
            }}
          >
            <option value="">＋ 선행 작업 추가...</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {projects.find((p) => p.id === t.projectId)?.name} · {t.name || '이름 없음'}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h4>링크 / 첨부</h4>
          {task.links.map((l) => (
            <div key={l.id} className="check-row">
              <a href={l.url} target="_blank" rel="noreferrer">
                🔗 {l.title}
              </a>
              <button className="icon-btn sm" onClick={() => update({ links: task.links.filter((x) => x.id !== l.id) })}>
                ✕
              </button>
            </div>
          ))}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              const url = link.trim();
              if (!url) return;
              const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
              update({ links: [...task.links, { id: uid(), url: full, title: url.replace(/^https?:\/\//, '') }] });
              setLink('');
            }}
          >
            <input className="inline-input" placeholder="＋ URL 붙여넣기" value={link} onChange={(ev) => setLink(ev.target.value)} />
          </form>
        </section>

        <section>
          <h4>
            댓글 <span className="count">{task.comments.length}</span>
          </h4>
          {task.comments.map((c) => {
            const m = members.find((x) => x.id === c.author);
            return (
              <div key={c.id} className="comment">
                {m ? <Avatar m={m} size={26} /> : <span className="avatar" style={{ background: '#94a3b8', width: 26, height: 26 }}>?</span>}
                <div>
                  <div className="comment-meta">
                    <b>{m?.name ?? '나'}</b> · {new Date(c.createdAt).toLocaleString('ko-KR')}
                    <button className="link-btn" onClick={() => update({ comments: task.comments.filter((x) => x.id !== c.id) })}>
                      삭제
                    </button>
                  </div>
                  <div className="comment-text">{c.text}</div>
                </div>
              </div>
            );
          })}
          <form
            className="comment-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!comment.trim()) return;
              update({ comments: [...task.comments, { id: uid(), author: currentUser, text: comment.trim(), createdAt: new Date().toISOString() }] });
              setComment('');
            }}
          >
            <textarea
              placeholder="댓글 작성... (⌘/Ctrl+Enter로 전송)"
              value={comment}
              onChange={(ev) => setComment(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) (ev.currentTarget.form as HTMLFormElement).requestSubmit();
              }}
            />
            <button className="btn primary sm">댓글</button>
          </form>
        </section>
        <div className="muted small">생성: {new Date(task.createdAt).toLocaleString('ko-KR')}</div>
      </div>
    </aside>
  );
}

function alertCycle() {
  window.dispatchEvent(new CustomEvent('mygantt:toast', { detail: '의존성을 추가할 수 없습니다 (중복 또는 순환)' }));
}

