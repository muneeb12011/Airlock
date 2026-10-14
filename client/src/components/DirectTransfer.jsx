// Browser-to-browser file transfer over WebRTC. The server only relays the
// connection handshake; file bytes go straight between the two browsers,
// encrypted by DTLS. Because the server never sees the file, File Shield
// can't inspect it — the UI says so and admins can turn this off.
import { useEffect } from "react";
import { create } from "zustand";
import { Zap, X, Check, TriangleAlert } from "lucide-react";
import { getSocket } from "../socket";
import { bytes } from "../lib/format";
import { Button } from "./ui";

const CHUNK = 64 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
if (import.meta.env.VITE_TURN_URL) {
  ICE.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
}

let pc = null;
let pendingIce = [];
let rx = { chunks: [], bytes: 0 };

const useTransfer = create((set, get) => ({
  incoming: null, // { from, fromName, offer, meta, id }
  active: null, // { id, dir, peer, peerName, name, size, progress, status, error }
  patch: (p) => set((s) => ({ active: s.active ? { ...s.active, ...p } : s.active })),
  reset: () => {
    try { pc?.close(); } catch { /* ignore */ }
    pc = null;
    pendingIce = [];
    rx = { chunks: [], bytes: 0 };
    set({ active: null });
  },
  fail: (error) => {
    try { pc?.close(); } catch { /* ignore */ }
    pc = null;
    get().patch({ status: "error", error });
  },
}));

function newPeer(peerId, transferId) {
  const conn = new RTCPeerConnection({ iceServers: ICE });
  conn.onicecandidate = (e) => e.candidate && getSocket()?.emit("webrtc:ice-candidate", { to: peerId, candidate: e.candidate, id: transferId });
  conn.onconnectionstatechange = () => {
    const st = useTransfer.getState().active?.status;
    if ((conn.connectionState === "failed" || conn.connectionState === "disconnected") && st !== "done") {
      useTransfer.getState().fail("The direct connection dropped. Networks with strict firewalls may need a TURN server — send it as a normal attachment instead.");
    }
  };
  return conn;
}

async function flushIce() {
  for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
  pendingIce = [];
}

export async function sendDirect(file, peerId, peerName) {
  const store = useTransfer.getState();
  if (store.active && !["done", "error"].includes(store.active.status)) return;
  store.reset();
  const id = crypto.randomUUID();
  useTransfer.setState({ active: { id, dir: "out", peer: peerId, peerName, name: file.name, size: file.size, progress: 0, status: "waiting" } });
  pc = newPeer(peerId, id);
  const dc = pc.createDataChannel("file", { ordered: true });
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = HIGH_WATER / 2;
  dc.onopen = async () => {
    useTransfer.getState().patch({ status: "sending" });
    try {
      let offset = 0;
      while (offset < file.size) {
        if (!useTransfer.getState().active) return; // cancelled
        if (dc.bufferedAmount > HIGH_WATER) {
          await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
        }
        const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
        dc.send(buf);
        offset += buf.byteLength;
        useTransfer.getState().patch({ progress: Math.round((offset / file.size) * 100) });
      }
      dc.send(JSON.stringify({ done: true }));
      useTransfer.getState().patch({ status: "done", progress: 100 });
    } catch {
      useTransfer.getState().fail("The transfer stopped part-way.");
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  getSocket()?.emit("webrtc:offer", { to: peerId, id, offer, meta: { fileName: file.name, fileSize: file.size, fileType: file.type } });
}

async function accept() {
  const { incoming } = useTransfer.getState();
  if (!incoming) return;
  const { from, fromName, offer, meta, id } = incoming;
  useTransfer.setState({ incoming: null, active: { id, dir: "in", peer: from, peerName: fromName, name: meta.fileName, size: meta.fileSize, progress: 0, status: "connecting" } });
  rx = { chunks: [], bytes: 0 };
  pc = newPeer(from, id);
  pc.ondatachannel = (e) => {
    const dc = e.channel;
    dc.binaryType = "arraybuffer";
    useTransfer.getState().patch({ status: "receiving" });
    dc.onmessage = (m) => {
      if (typeof m.data === "string") {
        const blob = new Blob(rx.chunks, { type: meta.fileType || "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = meta.fileName || "received-file";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        rx = { chunks: [], bytes: 0 };
        useTransfer.getState().patch({ status: "done", progress: 100 });
        return;
      }
      rx.chunks.push(m.data);
      rx.bytes += m.data.byteLength;
      useTransfer.getState().patch({ progress: Math.min(99, Math.round((rx.bytes / (meta.fileSize || 1)) * 100)) });
    };
  };
  await pc.setRemoteDescription(offer);
  await flushIce();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  getSocket()?.emit("webrtc:answer", { to: from, id, answer });
}

function decline() {
  const { incoming } = useTransfer.getState();
  if (incoming) getSocket()?.emit("webrtc:decline", { to: incoming.from, id: incoming.id });
  useTransfer.setState({ incoming: null });
}

function cancel() {
  const { active } = useTransfer.getState();
  if (active && active.status !== "done" && active.status !== "error") getSocket()?.emit("webrtc:cancel", { to: active.peer, id: active.id });
  useTransfer.getState().reset();
}

// Mounted once in the app shell: listens for signaling and shows the transfer card.
export function DirectTransferHost() {
  const incoming = useTransfer((s) => s.incoming);
  const active = useTransfer((s) => s.active);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const st = () => useTransfer.getState();
    const h = {
      "webrtc:offer": (p) => {
        if (st().active || st().incoming) return getSocket()?.emit("webrtc:decline", { to: p.from, id: p.id, busy: true });
        useTransfer.setState({ incoming: p });
      },
      "webrtc:answer": async ({ id, answer }) => {
        if (!pc || st().active?.id !== id) return;
        st().patch({ status: "connecting" });
        await pc.setRemoteDescription(answer).catch(() => st().fail("Couldn't connect."));
        await flushIce();
      },
      "webrtc:ice-candidate": async ({ id, candidate }) => {
        if (st().active?.id !== id && st().incoming?.id !== id) return;
        if (pc?.remoteDescription) await pc.addIceCandidate(candidate).catch(() => {});
        else pendingIce.push(candidate);
      },
      "webrtc:decline": ({ id, busy }) => {
        if (st().active?.id === id) st().fail(busy ? "They're already in another transfer." : "They declined the file.");
      },
      "webrtc:cancel": ({ id }) => {
        if (st().incoming?.id === id) useTransfer.setState({ incoming: null });
        if (st().active?.id === id) st().fail("The other side cancelled.");
      },
      "webrtc:error": ({ error }) => st().active?.dir === "out" && st().fail(error),
    };
    for (const [ev, fn] of Object.entries(h)) socket.on(ev, fn);
    return () => {
      for (const [ev, fn] of Object.entries(h)) socket.off(ev, fn);
    };
  });

  if (!incoming && !active) return null;

  return (
    <div className="panel" role="status" style={{ position: "fixed", zIndex: 60, left: 20, bottom: 20, width: "min(360px, calc(100vw - 40px))", boxShadow: "var(--shadow-pop)", padding: 14 }}>
      {incoming ? (
        <div className="col gap-12">
          <div className="row"><Zap size={16} color="var(--seal)" /><b>{incoming.fromName} wants to send you a file directly</b></div>
          <div className="small"><b>{incoming.meta?.fileName}</b> <span className="muted">({bytes(incoming.meta?.fileSize)})</span></div>
          <div className="small row top gap-8" style={{ color: "var(--signal)" }}><TriangleAlert size={14} style={{ flex: "none", marginTop: 2 }} /> Direct transfers skip File Shield. Only accept files you expect.</div>
          <div className="row">
            <Button variant="primary" size="sm" icon={<Check />} onClick={accept}>Accept</Button>
            <Button size="sm" onClick={decline}>Decline</Button>
          </div>
        </div>
      ) : (
        <div className="col gap-8">
          <div className="row between">
            <span className="row small" style={{ minWidth: 0 }}>
              <Zap size={15} color="var(--seal)" />
              <span className="ellipsis">{active.dir === "out" ? `To ${active.peerName}` : `From ${active.peerName}`}: <b>{active.name}</b></span>
            </span>
            <Button size="sm" variant="ghost" icon={<X />} aria-label="Close transfer" onClick={cancel} />
          </div>
          {active.status === "error" ? (
            <span className="small" style={{ color: "var(--breach)" }}>{active.error}</span>
          ) : active.status === "done" ? (
            <span className="small" style={{ color: "var(--seal)" }}>{active.dir === "out" ? "Delivered." : "Saved to your downloads."}</span>
          ) : (
            <>
              <div className="progress"><i style={{ width: `${active.progress}%` }} /></div>
              <span className="tiny muted">
                {active.status === "waiting" ? `Waiting for ${active.peerName} to accept…` : active.status === "connecting" ? "Connecting…" : `${active.progress}% of ${bytes(active.size)}`}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function useTransferBusy() {
  return useTransfer((s) => Boolean(s.active && s.active.status !== "done" && s.active.status !== "error"));
}
