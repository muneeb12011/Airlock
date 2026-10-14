import { create } from "zustand";
import { disconnectSocket } from "../socket";

function readUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem("user");
    return null;
  }
}

const useAuthStore = create((set) => ({
  user: readUser(),
  token: localStorage.getItem("token") || null,
  ready: false,

  setReady: (ready) => set({ ready }),

  login: (user, token) => {
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("token", token);
    set({ user, token });
  },

  logout: () => {
    disconnectSocket();
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
