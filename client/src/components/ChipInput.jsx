import { useId, useState } from "react";
import { X } from "lucide-react";

// Free-text tags with suggestions (labels). Enter or comma adds a chip.
export default function ChipInput({ value = [], onChange, suggestions = [], placeholder = "Add label", max = 10, label }) {
  const [text, setText] = useState("");
  const listId = useId();
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30);
  const add = (raw) => {
    const v = norm(raw);
    if (!v || value.includes(v) || value.length >= max) return setText("");
    onChange([...value, v]);
    setText("");
  };
  return (
    <div className="chips" onClick={(e) => e.currentTarget.querySelector("input")?.focus()}>
      {value.map((l) => (
        <span key={l} className="label-chip">
          {l}
          <button type="button" aria-label={`Remove ${l}`} onClick={() => onChange(value.filter((x) => x !== l))}><X size={11} /></button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        aria-label={label || placeholder}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value.slice(0, -1)) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(text); }
          if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
