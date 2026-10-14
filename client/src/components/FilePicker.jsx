import { useRef, useState } from "react";
import { Paperclip, X, ShieldCheck } from "lucide-react";
import { bytes } from "../lib/format";

const RISKY = ["exe", "dll", "scr", "bat", "cmd", "msi", "ps1", "vbs", "js", "jar", "apk", "iso", "lnk", "hta"];

// Drop zone + file input. Purely client-side hints; File Shield on the
// server makes the real decision.
export default function FilePicker({ file, onChange, compact = false, disabled }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const ext = file?.name.split(".").pop()?.toLowerCase();

  const pick = (f) => {
    onChange(f || null);
    if (input.current) input.current.value = "";
  };

  if (file) {
    return (
      <div className="file">
        <span className="ico"><Paperclip /></span>
        <div className="grow col gap-4">
          <span className="ellipsis" style={{ fontWeight: 600 }}>{file.name}</span>
          <span className="tiny muted">
            {bytes(file.size)} · {RISKY.includes(ext) ? <span style={{ color: "var(--breach)" }}>this file type will likely be blocked</span> : "File Shield checks it when you send"}
          </span>
        </div>
        <button type="button" className="btn ghost sm icon" aria-label="Remove file" onClick={() => pick(null)}><X /></button>
      </div>
    );
  }

  if (compact) {
    return (
      <>
        <button type="button" className="btn ghost icon" aria-label="Attach a file" disabled={disabled} onClick={() => input.current?.click()}><Paperclip /></button>
        <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files[0])} />
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      role="button"
      tabIndex={0}
      className="file"
      style={{ borderStyle: "dashed", cursor: "pointer", background: over ? "var(--seal-tint)" : undefined, justifyContent: "center", padding: 16 }}
    >
      <ShieldCheck size={18} color="var(--seal)" />
      <span className="small"><b>Attach a file</b> <span className="muted">— drop it here or click. It's scanned and fingerprinted on upload.</span></span>
      <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files[0])} />
    </div>
  );
}
