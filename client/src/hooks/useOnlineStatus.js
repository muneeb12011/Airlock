import { useEffect, useState } from "react";
import { connectSocket } from "../socket";

export default function useOnlineStatus() {
  const [onlineUserIds, setOnlineUserIds] = useState([]);

  useEffect(() => {
    const socket = connectSocket();

    const onPresence = ({ onlineUserIds }) => setOnlineUserIds(onlineUserIds);
    socket.on("presence:update", onPresence);

    return () => {
      socket.off("presence:update", onPresence);
      // Don't disconnect here — other components (like DirectFileTransfer)
      // may still be using the same shared socket.
    };
  }, []);

  const isOnline = (userId) => onlineUserIds.includes(String(userId));

  return { onlineUserIds, isOnline };
}