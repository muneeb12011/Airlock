import { useEffect, useState } from "react";
import api from "../../api";

export default function AdminLogsPage() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => { api.get("/admin/login-logs").then((r) => setLogs(r.data)); }, []);

  const filtered = logs.filter((l) =>
    `${l.name} ${l.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <input
        style={styles.search}
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <table style={styles.table}>
        <thead>
          <tr><th style={styles.th}>User</th><th style={styles.th}>Role</th><th style={styles.th}>IP</th><th style={styles.th}>When</th></tr>
        </thead>
        <tbody>
          {filtered.map((l) => (
            <tr key={l.id} style={styles.tr}>
              <td style={styles.td}>{l.name} ({l.email})</td>
              <td style={styles.td}>{l.role}</td>
              <td style={styles.td}>{l.ip_address}</td>
              <td style={styles.td}>{new Date(l.login_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <p style={{ color: "#79705f", marginTop: 12 }}>No matching logins.</p>}
    </div>
  );
}

const styles = {
  search: { padding: "8px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da", marginBottom: 16, width: "100%", maxWidth: 320 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #221d16", color: "#8a8071", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" },
  tr: { borderBottom: "1px solid #1a1712" },
  td: { padding: "10px 12px", fontSize: 13.5 },
};