import { useEffect, useState } from "react";
import { connectSocket } from "../socket";

export default function useOnlineStatus() {
  const [onlineUserIds, setOnlineUserIds] = useState([]);

  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return undefined;

    const onPresence = ({ onlineUserIds: ids }) => setOnlineUserIds(ids);
    socket.on("presence:update", onPresence);

    return () => {
      socket.off("presence:update", onPresence);
    };
  }, []);

  const isOnline = (userId) => onlineUserIds.includes(String(userId));

  return { onlineUserIds, isOnline };
}
