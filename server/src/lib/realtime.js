// Thin wrapper so routes can push events without importing socket.io directly.
let io = null;

export const setIo = (instance) => {
  io = instance;
};

export function emitToUser(userId, event, payload) {
  if (io && userId) io.to(`user:${userId}`).emit(event, payload);
}

export function emitToAdmins(event, payload) {
  if (io) io.to("role:admin").emit(event, payload);
}

// Kick every open socket for a user (after logout-everywhere, deletion, etc.)
export function disconnectUser(userId) {
  if (io && userId) io.in(`user:${userId}`).disconnectSockets(true);
}

// Put a connected user's sockets into a project room (after being added).
export function joinProject(userId, projectId) {
  if (io && userId && projectId) io.in(`user:${userId}`).socketsJoin(`project:${projectId}`);
}
export function leaveProject(userId, projectId) {
  if (io && userId && projectId) io.in(`user:${userId}`).socketsLeave(`project:${projectId}`);
}

// Tell everyone who can see a task that it changed, so open screens refresh.
export function taskChanged(task) {
  if (!io || !task) return;
  const payload = { taskId: task.id, status: task.status, projectId: task.project_id || null };
  let target = io.to("role:admin");
  if (task.project_id) target = target.to(`project:${task.project_id}`);
  if (task.assigned_to) target = target.to(`user:${task.assigned_to}`);
  if (task.assigned_by) target = target.to(`user:${task.assigned_by}`);
  target.emit("task:changed", payload);
}
