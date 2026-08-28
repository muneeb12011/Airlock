import { create } from "zustand";

const savedUser = localStorage.getItem("user");

const useAuthStore = create((set) => ({
  user: savedUser ? JSON.parse(savedUser) : null,
  token: localStorage.getItem("token") || null,

  login: (user, token) => {
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("token", token);
    set({ user, token });
  },

  logout: () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
