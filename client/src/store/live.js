import { create } from "zustand";

// Realtime state fed by the socket bridge.
const useLive = create((set) => ({
  connected: false,
  online: new Set(),
  notifications: [],
  unreadNotifications: 0,
  unreadMessages: 0,
  taskVersion: 0,
  lastMessage: null,
  lastRead: null,
  typingFrom: null,

  setConnected: (connected) => set({ connected }),
  setOnline: (ids) => set({ online: new Set(ids.map(String)) }),
  setNotifications: (items, unread) => set({ notifications: items, unreadNotifications: unread }),
  pushNotification: (n) => set((s) => ({ notifications: [n, ...s.notifications].slice(0, 50), unreadNotifications: s.unreadNotifications + 1 })),
  markAllRead: () => set((s) => ({ unreadNotifications: 0, notifications: s.notifications.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })) })),
  setUnreadMessages: (n) => set({ unreadMessages: Math.max(0, n) }),
  bumpTasks: () => set((s) => ({ taskVersion: s.taskVersion + 1 })),
  receiveMessage: (m) => set((s) => ({ lastMessage: m, typingFrom: s.typingFrom?.from === m.sender_id ? null : s.typingFrom })),
  receiveRead: (r) => set({ lastRead: r }),
  setTyping: (from) => set({ typingFrom: from ? { from, at: Date.now() } : null }),
  reset: () => set({ connected: false, online: new Set(), notifications: [], unreadNotifications: 0, unreadMessages: 0, lastMessage: null }),
}));

export default useLive;
