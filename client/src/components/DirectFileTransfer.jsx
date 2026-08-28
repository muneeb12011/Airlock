import { useEffect, useRef, useState } from "react";
import { connectSocket } from "../socket";

const CHUNK_SIZE = 256 * 1024; 
const BUFFER_THRESHOLD = CHUNK_SIZE * 8; 
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];



export default function DirectFileTransfer({ otherUserId, otherUserName, isOnline }) {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [incomingOffer, setIncomingOffer] = useState(null); 
  const [error, setError] = useState("");

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const receivedChunksRef = useRef([]);
  const receivedBytesRef = useRef(0);
  const incomingMetaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const socket = connectSocket();

    const onOffer = ({ from, offer, meta }) => {
      setIncomingOffer({ from, offer, meta });
    };
    const onAnswer = async ({ answer }) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };
    const onIceCandidate = async ({ candidate }) => {
      if (pcRef.current && candidate) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          // benign if it arrives before remote description is set in rare races
        }
      }
    };

    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice-candidate", onIceCandidate);

    return () => {
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice-candidate", onIceCandidate);
    };
  }, []);

  function makePeerConnection(targetUserId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        connectSocket().emit("webrtc:ice-candidate", { to: targetUserId, candidate: e.candidate });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setStatus("error");
        setError("Direct connection failed — try the regular attach button instead.");
      }
    };
    return pc;
  }

  // --- SENDER SIDE ---
  const pickFileAndSend = () => fileInputRef.current?.click();

  const startSend = async (file) => {
    if (!file || !isOnline) return;
    setStatus("connecting");
    setProgress(0);
    setError("");

    const pc = makePeerConnection(otherUserId);
    pcRef.current = pc;

    const dc = pc.createDataChannel("file");
    dc.binaryType = "arraybuffer";
    dcRef.current = dc;

    dc.onopen = () => {
      setStatus("transferring");
      sendFileOverChannel(dc, file);
    };
    dc.onerror = () => {
      setStatus("error");
      setError("Transfer failed mid-way.");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    connectSocket().emit("webrtc:offer", {
      to: otherUserId,
      offer,
      meta: { fileName: file.name, fileSize: file.size, fileType: file.type },
    });
  };

  // Faster sending: promise-based reads (Blob.arrayBuffer instead of FileReader
  // callbacks) + event-driven backpressure (onbufferedamountlow instead of
  // polling every 20ms). Bigger 256KB chunks mean far fewer round-trips for
  // the same file size.
  async function sendFileOverChannel(dc, file) {
    let offset = 0;

    try {
      while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        if (dc.bufferedAmount > BUFFER_THRESHOLD) {
          await new Promise((resolve) => {
            dc.bufferedAmountLowThreshold = BUFFER_THRESHOLD / 2;
            dc.onbufferedamountlow = () => {
              dc.onbufferedamountlow = null;
              resolve();
            };
          });
        }

        dc.send(buffer);
        offset += buffer.byteLength;
        setProgress(Math.min(100, Math.round((offset / file.size) * 100)));
      }

      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError("Transfer failed mid-way.");
    }
  }

  // --- RECEIVER SIDE ---
  const acceptIncoming = async () => {
    const { from, offer, meta } = incomingOffer;
    incomingMetaRef.current = meta;
    receivedChunksRef.current = [];
    receivedBytesRef.current = 0;
    setStatus("connecting");
    setProgress(0);
    setError("");

    const pc = makePeerConnection(from);
    pcRef.current = pc;

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      dc.binaryType = "arraybuffer";
      dcRef.current = dc;
      setStatus("transferring");

      dc.onmessage = (e) => {
        receivedChunksRef.current.push(e.data);
        receivedBytesRef.current += e.data.byteLength;
        const total = incomingMetaRef.current?.fileSize || 1;
        setProgress(Math.min(100, Math.round((receivedBytesRef.current / total) * 100)));

        if (receivedBytesRef.current >= total) {
          const blob = new Blob(receivedChunksRef.current, {
            type: incomingMetaRef.current?.fileType || "application/octet-stream",
          });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = incomingMetaRef.current?.fileName || "received-file";
          a.click();
          window.URL.revokeObjectURL(url);
          setStatus("done");
        }
      };
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    connectSocket().emit("webrtc:answer", { to: from, answer });

    setIncomingOffer(null);
  };

  const declineIncoming = () => setIncomingOffer(null);

  const reset = () => {
    if (pcRef.current) pcRef.current.close();
    pcRef.current = null;
    dcRef.current = null;
    setStatus("idle");
    setProgress(0);
    setError("");
  };

  return (
    <div style={styles.wrap}>
      {incomingOffer && (
        <div style={styles.incoming}>
          <span style={{ fontSize: 13 }}>
            {otherUserName} wants to send <strong>{incomingOffer.meta?.fileName}</strong>
            {" "}({formatBytes(incomingOffer.meta?.fileSize)}) directly
          </span>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button style={styles.acceptBtn} onClick={acceptIncoming}>Accept</button>
            <button style={styles.declineBtn} onClick={declineIncoming}>Decline</button>
          </div>
        </div>
      )}

      {status === "idle" && (
        <button
          style={{ ...styles.sendBtn, opacity: isOnline ? 1 : 0.5 }}
          disabled={!isOnline}
          onClick={pickFileAndSend}
          title={isOnline ? "Send a file directly, peer-to-peer" : `${otherUserName} is offline`}
        >
          ⚡ Send Direct {!isOnline && "(offline)"}
        </button>
      )}

      {(status === "connecting" || status === "transferring") && (
        <div style={styles.progressWrap}>
          <div style={styles.progressLabel}>
            {status === "connecting" ? "Connecting..." : `Transferring... ${progress}%`}
          </div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
        </div>
      )}

      {status === "done" && (
        <div style={styles.doneRow}>
          <span style={{ color: "#5fa876", fontSize: 12.5 }}>Transfer complete ✓</span>
          <button style={styles.resetBtn} onClick={reset}>Send another</button>
        </div>
      )}

      {status === "error" && (
        <div style={styles.doneRow}>
          <span style={{ color: "#e0836b", fontSize: 12.5 }}>{error}</span>
          <button style={styles.resetBtn} onClick={reset}>Try again</button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => startSend(e.target.files[0])}
      />
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const styles = {
  wrap: { marginTop: 8 },
  sendBtn: {
    padding: "7px 12px", borderRadius: 3, border: "1px solid #2f2820",
    background: "#1c1712", color: "#c98a3e", cursor: "pointer", fontSize: 12.5,
  },
  incoming: { background: "#1c1712", border: "1px solid #c98a3e", borderRadius: 4, padding: 10, marginBottom: 8, color: "#ece6da" },
  acceptBtn: { padding: "5px 12px", borderRadius: 3, border: "none", background: "#5fa876", color: "#0b0a08", fontWeight: 700, cursor: "pointer", fontSize: 12 },
  declineBtn: { padding: "5px 12px", borderRadius: 3, border: "1px solid #2f2820", background: "transparent", color: "#a8a091", cursor: "pointer", fontSize: 12 },
  progressWrap: { marginTop: 4 },
  progressLabel: { fontSize: 12, color: "#a8895a", marginBottom: 4 },
  progressTrack: { width: "100%", height: 6, background: "#100e0b", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: "#c98a3e", transition: "width 0.15s" },
  doneRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 4 },
  resetBtn: { padding: "4px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "transparent", color: "#a8a091", cursor: "pointer", fontSize: 11.5 },
};