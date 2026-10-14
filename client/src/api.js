import axios from "axios";
import { API_URL } from "./lib/config";

export const TOKEN_KEY = "airlock-token";

const api = axios.create({ baseURL: API_URL, timeout: 120_000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Hooks set by the auth store, so this module doesn't import it (no cycle).
const handlers = { onUnauthorized: () => {}, onSetupRequired: () => {} };
export const setApiHandlers = (h) => Object.assign(handlers, h);

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = String(err.config?.url || "");
    if (status === 401 && !url.startsWith("/auth/login")) handlers.onUnauthorized();
    if (status === 403 && err.response?.data?.code === "SETUP_REQUIRED") handlers.onSetupRequired(err.response.data);
    return Promise.reject(err);
  }
);

export default api;
