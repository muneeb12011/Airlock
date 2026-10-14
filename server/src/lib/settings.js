import { query } from "../db.js";

export const DEFAULTS = {
  enforce_2fa: false,
  allow_p2p: true,
  workspace_name: "Airlock",
  extra_origins: [],
  member_dm: "team", // off | team | all
  retention_days: 180,
  default_due_days: 7,
  channels: ["Blog", "Email", "Instagram", "LinkedIn", "X", "YouTube", "Website", "Ads"],
};

let cache = null;
let cachedAt = 0;
const TTL_MS = 15_000;

export async function getSettings() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const { rows } = await query("SELECT key, value FROM app_settings");
  cache = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  cachedAt = Date.now();
  return cache;
}

// Last loaded settings without hitting the DB (for hot paths like CORS).
export const cachedSettings = () => cache || DEFAULTS;

export async function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS) || value === undefined) continue;
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
  }
  cache = null;
  return getSettings();
}

// What any signed-in user may see.
export function publicSettings(s) {
  return {
    workspace_name: s.workspace_name,
    enforce_2fa: s.enforce_2fa,
    allow_p2p: s.allow_p2p,
    member_dm: s.member_dm,
    channels: s.channels,
    default_due_days: s.default_due_days,
  };
}
