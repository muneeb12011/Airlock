import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Check, CircleAlert, Info, Clock, Paperclip, ShieldCheck, TriangleAlert, Download, Copy,
} from "lucide-react";
import useToast, { toast } from "../store/toast";
import useLive from "../store/live";
import { API_URL } from "../lib/config";
import { STATUS, PRIORITIES, dueLabel, initials, avatarColor, bytes } from "../lib/format";

export function Button({ loading, children, className = "", variant, size, icon, block, ...rest }) {
  const cls = ["btn", variant, size, icon && !children ? "icon" : "", block ? "block" : "", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

function useFocusTrapStart(ref) {
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current?.querySelector("input, textarea, select, button:not([data-close])");
    (el || ref.current)?.focus?.();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [ref]);
}

export function Modal({ title, onClose, children, footer, labelledBy = "modal-title" }) {
  const ref = useRef(null);
  useEscape(onClose);
  useFocusTrapStart(ref);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 className="h2" id={labelledBy}>{title}</h2>
          <Button variant="ghost" size="sm" icon={<X />} aria-label="Close" data-close onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

export function Drawer({ onClose, header, children }) {
  const ref = useRef(null);
  useEscape(onClose);
  useFocusTrapStart(ref);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div className="grow">{header}</div>
          <Button variant="ghost" size="sm" icon={<X />} aria-label="Close" data-close onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body
  );
}

export function Toasts() {
  const items = useToast((s) => s.items);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.tone === "bad" ? <CircleAlert /> : t.tone === "ok" ? <Check /> : <Info />}
          <div>{t.text}</div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon}
      {title && <div className="h3">{title}</div>}
      {children && <div className="small" style={{ maxWidth: "46ch" }}>{children}</div>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "", icon, title, children }) {
  const Icon = icon || (tone === "bad" ? CircleAlert : tone === "warn" ? TriangleAlert : tone === "ok" ? ShieldCheck : Info);
  return (
    <div className={`callout ${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <Icon />
      <div className="body">
        {title && <div style={{ fontWeight: 650 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name, id, size = "", showPresence = false, src }) {
  const online = useLive((s) => s.online.has(String(id)));
  const [broken, setBroken] = useState(false);
  const url = src && !broken ? (src.startsWith("http") ? src : `${API_URL}${src}`) : null;
  return (
    <span className={`avatar ${size}`} style={{ background: url ? "var(--bg-sunk)" : avatarColor(id ?? name) }} aria-hidden>
      {url ? <img src={url} alt="" onError={() => setBroken(true)} /> : initials(name)}
      {showPresence && <span className={`presence ${online ? "on" : ""}`} />}
    </span>
  );
}

// Coloured project key chip: "WEB-12".
export function TaskKey({ task, k, color }) {
  const key = k || task?.key;
  if (!key) return null;
  return (
    <span className="task-key" style={{ "--pc": color || task?.project_color || "var(--muted)" }}>
      {key}
    </span>
  );
}

export function Labels({ labels = [], max = 4 }) {
  if (!labels?.length) return null;
  return (
    <span className="labels">
      {labels.slice(0, max).map((l) => (
        <span key={l} className="label-chip">{l}</span>
      ))}
      {labels.length > max && <span className="label-chip">+{labels.length - max}</span>}
    </span>
  );
}

export function StatusPill({ status }) {
  return (
    <span className={`pill ${status}`}>
      <span className="lamp" />
      {STATUS[status] || status}
    </span>
  );
}

export function Priority({ value }) {
  return (
    <span className={`prio ${value}`} title={`${PRIORITIES[value]} priority`}>
      <i><b /><b /><b /></i>
      {PRIORITIES[value] || value}
    </span>
  );
}

export function Due({ date, status }) {
  const d = dueLabel(date, status);
  if (!d) return null;
  return (
    <span className={`due ${d.tone}`}>
      <Clock aria-hidden />
      {d.text}
    </span>
  );
}

// A SHA-256 fingerprint drawn as 16 coloured bars, so two files can be
// compared at a glance without reading 64 hex characters.
export function Fingerprint({ hash, short = true }) {
  if (!hash) return null;
  const bars = [];
  for (let i = 0; i < 64; i += 4) {
    const v = parseInt(hash.slice(i, i + 4), 16);
    bars.push(`hsl(${Math.round((v / 65535) * 360)} 55% ${42 + (v % 5) * 4}%)`);
  }
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(hash).then(() => toast.ok("Fingerprint copied"));
  };
  return (
    <span className="fp" title={`SHA-256 ${hash}`}>
      <span className="fp-strip" aria-hidden>
        {bars.map((c, i) => <i key={i} style={{ background: c }} />)}
      </span>
      <span className="fp-text">{short ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash}</span>
      <button type="button" className="btn ghost sm icon" style={{ width: 24, height: 24 }} onClick={copy} aria-label="Copy SHA-256 fingerprint">
        <Copy />
      </button>
    </span>
  );
}

export function FileChip({ file, legacyName, onDownload, downloading }) {
  const name = file?.name || legacyName || "attachment";
  const warn = file?.risk_level === "warn";
  return (
    <div className={`file ${warn ? "warn" : ""}`}>
      <span className="ico" aria-hidden>{warn ? <TriangleAlert /> : file ? <ShieldCheck /> : <Paperclip />}</span>
      <div className="grow col gap-4">
        <div className="row gap-4">
          <span className="ellipsis" style={{ fontWeight: 600 }}>{name}</span>
          {file && <span className="faint tiny nowrap">{bytes(file.size)}</span>}
        </div>
        {file ? <Fingerprint hash={file.sha256} /> : <span className="tiny faint">Uploaded before File Shield — not fingerprinted</span>}
        {warn && (file.risk_notes || []).map((n, i) => <span key={i} className="tiny" style={{ color: "var(--signal)" }}>{n}</span>)}
      </div>
      {onDownload && (
        <Button size="sm" variant="ghost" icon={<Download />} loading={downloading} onClick={onDownload} aria-label={`Download ${name}`} />
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, className = "", htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

export function Skeleton({ h = 16, w = "100%", style }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}
