// Bootstrap (or recover) an admin account from the command line.
//
//   npm run create-admin -- --email you@company.com --name "Your Name"
//
// Prints a one-time temporary password; you'll be asked to change it on
// first sign-in. Running it again for an existing email resets that
// account's password, unlocks it, and makes sure it's an active admin —
// useful if the only admin is ever locked out.
import { parseArgs } from "util";
import { pool } from "../db.js";
import { runMigrations } from "../migrate.js";
import { hashPassword } from "../lib/passwords.js";
import { tempPassword } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
  },
});

const email = String(values.email || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- --email you@company.com --name "Your Name"');
  process.exit(1);
}
const name = String(values.name || email.split("@")[0]).trim();
const password = values.password || tempPassword();

try {
  await runMigrations({ log: () => {} });
  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ($1,$2,$3,'admin',true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true,
       must_change_password = true, failed_attempts = 0, locked_until = NULL,
       token_version = users.token_version + 1
     RETURNING id, (xmax = 0) AS created`,
    [name, email, hash]
  );
  await audit(null, rows[0].created ? "user.created" : "user.password_reset", {
    actor: { id: null, name: "cli:create-admin" },
    targetType: "user",
    targetId: rows[0].id,
    meta: { email, role: "admin" },
  });
  console.log(`\n  ${rows[0].created ? "Created" : "Reset"} admin ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log("  You'll be asked to set a new one when you sign in.\n");
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
