const raw = import.meta.env.VITE_API_URL || "";
export const API_URL = raw.replace(/\/$/, "") || (import.meta.env.DEV ? "http://localhost:5000" : "");
export const isApiConfigured = Boolean(API_URL);
