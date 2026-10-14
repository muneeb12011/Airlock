import { io } from "socket.io-client";
import { API_URL } from "./lib/config";

let socket = null;
let currentToken = null;

export function connectSocket(token) {
  if (!token || !API_URL) return null;
  if (socket && currentToken === token) return socket;
  disconnectSocket();
  currentToken = token;
  socket = io(API_URL, { auth: { token }, transports: ["websocket", "polling"], reconnectionDelayMax: 8000 });
  return socket;
}

export const getSocket = () => socket;

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
  currentToken = null;
}
