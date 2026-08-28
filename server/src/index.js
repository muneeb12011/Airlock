// Local dev entrypoint only. On Vercel, api/index.js is used instead
// (serverless functions don't call .listen()).
import http from "http";
import app from "./app.js";
import { initSocket } from "./socket.js";

const PORT = process.env.PORT || 5000;

// Socket.io needs a raw HTTP server to attach to (not just the Express app),
// since it upgrades connections to WebSockets.
const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => console.log(`Server running on port ${PORT} (with sockets)`));