import { create } from "zustand";

let seq = 0;
const useToast = create((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, tone: "ok", ...t }].slice(-4) }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.duration || 4500);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  ok: (text, opts) => useToast.getState().push({ text, tone: "ok", ...opts }),
  bad: (text, opts) => useToast.getState().push({ text, tone: "bad", duration: 7000, ...opts }),
  info: (text, opts) => useToast.getState().push({ text, tone: "info", ...opts }),
};
export default useToast;
