import { useEffect, useState } from "react";
import api from "../../api";
import { readAxiosError } from "../../lib/download";

export default function AdminLogsPage() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/admin/login-logs")
      .then((r) => setLogs(r.data))
      .catch(async (err) => setError(await readAxiosError(err, "Could not load login logs.")))
      .finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter((l) =>
    `${l.name} ${l.email}`.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <p className="muted">Loading logs…</p>;

  return (
    <div>
      {error && <div className="banner error">{error}</div>}
      <input
        className="search"
        style={{ marginBottom: 16, width: "100%", maxWidth: 320 }}
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>User</th><th>Role</th><th>IP</th><th>When</th></tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <td>{l.name} ({l.email})</td>
                <td>{l.role}</td>
                <td>{l.ip_address}</td>
                <td>{new Date(l.login_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No matching logins.</p>}
    </div>
  );
}
