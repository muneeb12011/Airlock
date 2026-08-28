import { io } from "socket.io-client";

// Reuse the same base URL your axios instance points at, minus any /api
// path suffix if you have one — socket.io connects at the server root.
const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

let socket = null;

export function getSocket() {
  if (socket) return socket;

  const token = localStorage.getItem("token");
  socket = io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
  });

  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}