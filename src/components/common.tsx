import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ID, Member } from '../types';
import { initials } from '../lib/util';
import { useStore } from '../store';

/* ---------------- toast ---------------- */
export function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('mygantt:toast', { detail: msg }));
}

export function Toaster() {
  const [msgs, setMsgs] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    const h = (e: Event) => {
      const id = Date.now() + Math.random();
      setMsgs((m) => [...m, { id, text: (e as CustomEvent).detail }]);
      setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 2600);
    };
    window.addEventListener('mygantt:toast', h);
    return () => window.removeEventListener('mygantt:toast', h);
  }, []);
  return (
    <div className="toaster">
      {msgs.map((m) => (
        <div key={m.id} className="toast">
          {m.text}
        </div>
      ))}
    </div>
  );
}

/* ---------------- avatars ---------------- */
export function Avatar({ m, size = 22 }: { m: Member; size?: number }) {
  return (
    <span
      className="avatar"
      title={m.name}
      style={{ background: m.color, width: size, height: size, fontSize: size * 0.42, lineHeight: `${size}px` }}
    >
      {initials(m.name)}
    </span>
  );
}

export function Avatars({ ids, max = 3, size = 22 }: { ids: ID[]; max?: number; size?: number }) {
  const members = useStore((s) => s.members);
  const ms = ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as Member[];
  if (!ms.length) return null;
  return (
    <span className="avatars">
      {ms.slice(0, max).map((m) => (
        <Avatar key={m.id} m={m} size={size} />
      ))}
      {ms.length > max && (
        <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.42, lineHeight: `${size}px` }}>
          +{ms.length - max}
        </span>
      )}
    </span>
  );
}

/* ---------------- popover ---------------- */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'left',
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = align === 'right' ? anchor.x - r.width : anchor.x;
    let y = anchor.y;
    if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, anchor.y - r.height - 8);
    setPos({ x: Math.max(8, x), y });
  }, [anchor.x, anchor.y, align]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="popover" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  divider?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function Menu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="menu">
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-divider" />
        ) : (
          <button
            key={i}
            className={`menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            <span className="menu-check">{it.checked ? '✓' : it.icon ?? ''}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Button that opens a dropdown */
export function Dropdown({
  button,
  children,
  className = 'btn',
  title,
  align = 'left',
}: {
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  title?: string;
  align?: 'left' | 'right';
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        className={className}
        title={title}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: align === 'right' ? r.right : r.left, y: r.bottom + 4 });
        }}
      >
        {button}
      </button>
      {anchor && (
        <Popover anchor={anchor} align={align} onClose={() => setAnchor(null)}>
          {children(() => setAnchor(null))}
        </Popover>
      )}
    </>
  );
}

/* ---------------- member picker ---------------- */
export function MemberPicker({ value, onChange }: { value: ID[]; onChange: (ids: ID[]) => void }) {
  const members = useStore((s) => s.members);
  const addMember = useStore((s) => s.addMember);
  const [name, setName] = useState('');
  return (
    <div className="member-picker">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            className={`menu-item${on ? ' active' : ''}`}
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
          >
            <span className="menu-check">{on ? '✓' : ''}</span>
            <Avatar m={m} size={20} />
            <span className="menu-label">{m.name}</span>
          </button>
        );
      })}
      <form
        className="member-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = addMember(name.trim());
          onChange([...value, id]);
          setName('');
        }}
      >
        <input placeholder="+ 새 팀원 추가" value={name} onChange={(e) => setName(e.target.value)} />
      </form>
    </div>
  );
}

/* ---------------- modal ---------------- */
export function Modal({ title, onClose, children, width = 560 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ColorSwatches({ value, onChange, allowNone }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean }) {
  const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none${value == null ? ' on' : ''}`} title="프로젝트 색상" onClick={() => onChange(null)}>
          ∅
        </button>
      )}
      {colors.map((c) => (
        <button key={c} className={`swatch${value === c ? ' on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}
