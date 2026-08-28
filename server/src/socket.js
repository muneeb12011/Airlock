import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { query } from "./db.js";

// userId -> Set of socket ids (a user could have multiple tabs open)
const onlineUsers = new Map();

function broadcastPresence(io) {
  io.emit("presence:update", { onlineUserIds: [...onlineUsers.keys()] });
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || "*" },
  });

  // Same check as the authenticate() HTTP middleware: verify the JWT AND
  // confirm the user still exists, so a deleted user can't open a socket.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token provided"));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query("SELECT id, name, role FROM users WHERE id = $1", [payload.id]);
      if (!result.rows[0]) return next(new Error("Account no longer exists"));
      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.user.id);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    broadcastPresence(io);

    // Send the current list to the person who just connected too.
    socket.emit("presence:update", { onlineUserIds: [...onlineUsers.keys()] });

    // --- WebRTC signaling relay ---
    // The server never sees file contents — it only forwards the connection
    // handshake messages between the two browsers so they can find each other.
    const relay = (event) => (payload) => {
      const targetId = String(payload.to);
      const targetSockets = onlineUsers.get(targetId);
      if (!targetSockets) return; // target isn't online, sender's UI should handle this
      for (const sockId of targetSockets) {
        io.to(sockId).emit(event, { ...payload, from: userId });
      }
    };

    socket.on("webrtc:offer", relay("webrtc:offer"));
    socket.on("webrtc:answer", relay("webrtc:answer"));
    socket.on("webrtc:ice-candidate", relay("webrtc:ice-candidate"));

    socket.on("disconnect", () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) onlineUsers.delete(userId);
      }
      broadcastPresence(io);
    });
  });

  return io;
}