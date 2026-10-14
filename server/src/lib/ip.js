// req.ip honours `trust proxy`, which is set to an explicit hop count in
// app.js — so X-Forwarded-For can only be trusted as far as our own proxies.
export function clientIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return ip.replace(/^::ffff:/, "");
}

export function socketIp(socket, trustProxy) {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  if (trustProxy > 0 && fwd) {
    const parts = String(fwd).split(",").map((s) => s.trim());
    const idx = Math.max(0, parts.length - trustProxy);
    return (parts[idx] || "").replace(/^::ffff:/, "");
  }
  return (socket.handshake.address || "").replace(/^::ffff:/, "");
}
