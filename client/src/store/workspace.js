import { create } from "zustand";
import api from "../api";

// Shared lists many screens need: people, projects, teams. Loaded once and
// refreshed after edits.
const useWorkspace = create((set, get) => ({
  people: null,
  projects: null,
  teams: null,
  labels: null,
  async loadPeople(force) {
    if (get().people && !force) return get().people;
    const { data } = await api.get("/users/directory");
    set({ people: data });
    return data;
  },
  async loadProjects(force) {
    if (get().projects && !force) return get().projects;
    const { data } = await api.get("/projects");
    set({ projects: data });
    return data;
  },
  async loadTeams(force) {
    if (get().teams && !force) return get().teams;
    const { data } = await api.get("/teams");
    set({ teams: data });
    return data;
  },
  async loadLabels(force) {
    if (get().labels && !force) return get().labels;
    const { data } = await api.get("/tasks/labels");
    set({ labels: data });
    return data;
  },
  reset: () => set({ people: null, projects: null, teams: null, labels: null }),
}));

export default useWorkspace;
