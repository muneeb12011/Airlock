import { Server } from "socket.io";
import { corsOrigin } from "./app.js";
import { query } from "./db.js";
import { userFromToken } from "./middleware/auth.js";
import { setIo } from "./lib/realtime.js";
import { getSettings } from "./lib/settings.js";
import { canMessage } from "./lib/access.js";
import { audit } from "./lib/audit.js";

// userId -> { sockets:Set }
const online = new Map();
const onlineIds = () => [...online.keys()];

async function loadUser(id) {
  const { rows } = await query(`SELECT id, name, role, is_active FROM users WHERE id = $1`, [id]);
  return rows[0];
}

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin },
    maxHttpBufferSize: 256 * 1024, // signaling only — files never pass through here
  });
  setIo(io);

  io.use(async (socket, next) => {
    const user = await userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("unauthorized"));
    socket.user = user;
    next();
  });

  io.on("connection", async (socket) => {
    const { id, role } = socket.user;
    const key = String(id);
    socket.join(`user:${id}`);
    if (role === "admin") socket.join("role:admin");
    try {
      const { rows } = await query(`SELECT project_id FROM project_members WHERE user_id = $1`, [id]);
      for (const r of rows) socket.join(`project:${r.project_id}`);
    } catch {
      /* rooms are an optimisation; REST still works */
    }

    if (!online.has(key)) online.set(key, { sockets: new Set() });
    online.get(key).sockets.add(socket.id);
    io.emit("presence:update", { onlineUserIds: onlineIds() });

    // Cache of "may I talk to X" answers for this connection.
    const allowed = new Map();
    const mayTalkTo = async (to) => {
      const k = String(to);
      if (allowed.has(k)) return allowed.get(k);
      const target = await loadUser(Number(to));
      const ok = await canMessage(socket.user, target);
      allowed.set(k, ok);
      return ok;
    };

    // --- WebRTC signaling relay for direct browser-to-browser transfer ---
    // The server only forwards the handshake; file bytes never touch it.
    const relay = (event) => async (payload = {}) => {
      if (!online.has(String(payload.to))) return socket.emit("webrtc:error", { to: payload.to, error: "They're offline." });
      if (!(await mayTalkTo(payload.to))) return socket.emit("webrtc:error", { to: payload.to, error: "You can't send files to this person." });
      if (event === "webrtc:offer") {
        const settings = await getSettings();
        if (!settings.allow_p2p) {
          return socket.emit("webrtc:error", { to: payload.to, error: "Direct transfers are turned off by your admin." });
        }
        audit(null, "p2p.offer", {
          actor: socket.user,
          targetType: "user",
          targetId: payload.to,
          meta: { name: String(payload.meta?.fileName || "").slice(0, 200), size: Number(payload.meta?.fileSize) || 0 },
        });
      }
      io.to(`user:${payload.to}`).emit(event, { ...payload, from: key, fromName: socket.user.name });
    };

    for (const ev of ["webrtc:offer", "webrtc:answer", "webrtc:ice-candidate", "webrtc:decline", "webrtc:cancel"]) {
      socket.on(ev, relay(ev));
    }

    socket.on("typing", async ({ to } = {}) => {
      if (!to || !(await mayTalkTo(to))) return;
      io.to(`user:${to}`).emit("typing", { from: id });
    });

    socket.on("disconnect", () => {
      const entry = online.get(key);
      if (entry) {
        entry.sockets.delete(socket.id);
        if (entry.sockets.size === 0) online.delete(key);
      }
      io.emit("presence:update", { onlineUserIds: onlineIds() });
    });
  });

  return io;
}
