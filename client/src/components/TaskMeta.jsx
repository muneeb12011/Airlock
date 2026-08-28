const TYPE_LABELS = { feature: "Feature", bug: "Bug Fix", docs: "Documentation", research: "Research", review: "Review", other: "Other" };
const PRIORITY_COLORS = { low: "#5c5344", medium: "#c98a3e", high: "#e0836b", urgent: "#ff5c4d" };

export default function TaskMeta({ task }) {
  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
  const typeLabel = TYPE_LABELS[task.type] || "Other";
  const overdue = task.due_date && task.status !== "completed" && new Date(task.due_date) < new Date(new Date().toDateString());

  return (
    <div style={styles.row}>
      <span style={{ ...styles.badge, borderColor: priorityColor, color: priorityColor }}>
        {task.priority ? task.priority[0].toUpperCase() + task.priority.slice(1) : "Medium"}
      </span>
      <span style={styles.badgeType}>{typeLabel}</span>
      {task.due_date && (
        <span style={{ fontSize: 12.5, color: overdue ? "#e0836b" : "#79705f" }}>
          {overdue ? "Overdue — " : "Due "}{new Date(task.due_date).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

const styles = {
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 },
  badge: { fontSize: 11, fontFamily: "ui-monospace, monospace", border: "1px solid", borderRadius: 3, padding: "1px 6px" },
  badgeType: { fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#8a8071", border: "1px solid #2f2820", borderRadius: 3, padding: "1px 6px" },
};