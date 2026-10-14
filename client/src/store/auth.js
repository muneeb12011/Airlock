import { create } from "zustand";
import api, { TOKEN_KEY, setApiHandlers } from "../api";
import { disconnectSocket } from "../socket";

const read = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
const write = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
};

const useAuth = create((set, get) => ({
  token: read(),
  user: null,
  settings: { enforce_2fa: false, allow_p2p: true },
  status: "booting", // booting | ready

  async boot() {
    if (!get().token) return set({ status: "ready", user: null });
    try {
      const { data } = await api.get("/auth/me");
      set({ user: data.user, settings: data.settings, status: "ready" });
    } catch {
      get().logout();
      set({ status: "ready" });
    }
  },

  // Called with the { token, user } payload any auth endpoint returns.
  setSession({ token, user }) {
    if (token) write(token);
    set((s) => ({ token: token || s.token, user: { ...s.user, ...user } }));
  },

  async refresh() {
    const { data } = await api.get("/auth/me");
    set({ user: data.user, settings: data.settings });
    return data.user;
  },

  logout() {
    write(null);
    disconnectSocket();
    set({ token: null, user: null });
  },

  markSetupRequired(flags) {
    set((s) => (s.user ? { user: { ...s.user, must_change_password: !!flags.must_change_password, must_enroll_2fa: !!flags.must_enroll_2fa } } : {}));
  },
}));

setApiHandlers({
  onUnauthorized: () => {
    if (useAuth.getState().token) useAuth.getState().logout();
  },
  onSetupRequired: (data) => useAuth.getState().markSetupRequired(data),
});

export const needsSetup = (u) => Boolean(u && (u.must_change_password || u.must_enroll_2fa));
export default useAuth;
