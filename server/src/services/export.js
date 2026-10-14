import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import { config } from "../config.js";

const label = (s) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const fmt = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
export const slug = (text) => (text || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";

function metaRows(task) {
  return [
    ["Task", task.key ? `${task.key} (#${task.id})` : `#${task.id}`],
    ["Project", task.project_name || "—"],
    ["Status", label(task.status)],
    ["Type", label(task.type)],
    ["Priority", label(task.priority)],
    ["Assigned to", task.assignee_name || "—"],
    ["Assigned by", task.assigned_by_name || "—"],
    ["Due date", task.due_date || "—"],
    ["Created", fmt(task.created_at)],
    ["Completed", fmt(task.completed_at)],
  ];
}

export function generateTaskPDF(task, submissions, comments, res, exportedBy) {
  const doc = new PDFDocument({ margin: 56, size: "A4", info: { Title: task.title, Producer: config.appName } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="task-${task.id}-${slug(task.title)}.pdf"`);
  doc.pipe(res);

  const ink = "#16181d";
  const dim = "#6b7080";
  const accent = "#3b5bdb";

  doc.fillColor(accent).fontSize(9).font("Helvetica-Bold").text(`${config.appName.toUpperCase()} · TASK REPORT`, { characterSpacing: 1.5 });
  doc.moveDown(0.6);
  doc.fillColor(ink).fontSize(22).font("Helvetica-Bold").text(task.title);
  doc.moveDown(0.8);

  doc.fontSize(10);
  for (const [k, v] of metaRows(task)) {
    const y = doc.y;
    doc.font("Helvetica").fillColor(dim).text(k, 56, y, { width: 110 });
    doc.font("Helvetica-Bold").fillColor(ink).text(v, 170, y);
  }
  doc.moveDown(1.2);

  const section = (title) => {
    doc.moveDown(0.6);
    doc.x = 56;
    doc.fillColor(accent).font("Helvetica-Bold").fontSize(12).text(title);
    doc.moveTo(56, doc.y + 2).lineTo(539, doc.y + 2).strokeColor("#dfe2ea").lineWidth(1).stroke();
    doc.moveDown(0.6);
    doc.fillColor(ink).font("Helvetica").fontSize(10.5);
  };

  section("Description");
  doc.text(task.description || "No description provided.", { lineGap: 2 });

  section(`Submissions (${submissions.length})`);
  if (!submissions.length) doc.text("Nothing submitted yet.");
  submissions.forEach((s, i) => {
    doc.font("Helvetica-Bold").text(`${submissions.length - i}. ${fmt(s.submitted_at)} — ${s.submitted_by_name || "former member"}`);
    doc.font("Helvetica").fillColor(dim).text(`Review: ${label(s.review_status)}${s.reviewed_by_name ? ` by ${s.reviewed_by_name}` : ""}${s.reviewed_at ? ` · ${fmt(s.reviewed_at)}` : ""}`);
    doc.fillColor(ink).text(s.notes || "(no notes)", { lineGap: 2 });
    if (s.review_note) doc.fillColor(dim).text(`Reviewer note: ${s.review_note}`).fillColor(ink);
    if (s.file) {
      doc.fillColor(dim).fontSize(9).text(`File: ${s.file.name} (${(s.file.size / 1024).toFixed(1)} KB)`);
      doc.font("Courier").text(`SHA-256: ${s.file.sha256}`).font("Helvetica").fontSize(10.5).fillColor(ink);
    }
    doc.moveDown(0.6);
  });

  if (comments.length) {
    section(`Discussion (${comments.length})`);
    for (const c of comments) {
      doc.font("Helvetica-Bold").text(`${c.author_name || "former member"} · ${fmt(c.created_at)}`);
      doc.font("Helvetica").text(c.message, { lineGap: 2 });
      doc.moveDown(0.4);
    }
  }

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor(dim).text(`Exported ${fmt(new Date())} by ${exportedBy}. File fingerprints let the recipient verify a deliverable hasn't been altered.`);
  doc.end();
}

const cell = (text, bold = false) =>
  new TableCell({
    width: { size: bold ? 25 : 75, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "DFE2EA" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold, color: bold ? "6B7080" : "16181D", size: 20 })] })],
  });

export async function generateTaskDocx(task, submissions, comments, res, exportedBy) {
  const children = [
    new Paragraph({ children: [new TextRun({ text: `${config.appName.toUpperCase()} · TASK REPORT`, bold: true, color: "3B5BDB", size: 16 })] }),
    new Paragraph({ text: task.title, heading: HeadingLevel.TITLE }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: metaRows(task).map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v)] })),
    }),
    new Paragraph({ text: "Description", heading: HeadingLevel.HEADING_2 }),
    ...String(task.description || "No description provided.").split("\n").map((line) => new Paragraph({ text: line })),
    new Paragraph({ text: `Submissions (${submissions.length})`, heading: HeadingLevel.HEADING_2 }),
  ];
  if (!submissions.length) children.push(new Paragraph({ text: "Nothing submitted yet." }));
  submissions.forEach((s, i) => {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `${submissions.length - i}. ${fmt(s.submitted_at)} — ${s.submitted_by_name || "former member"}`, bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: `Review: ${label(s.review_status)}${s.reviewed_by_name ? ` by ${s.reviewed_by_name}` : ""}`, color: "6B7080" })] }),
      ...String(s.notes || "(no notes)").split("\n").map((line) => new Paragraph({ text: line }))
    );
    if (s.review_note) children.push(new Paragraph({ children: [new TextRun({ text: `Reviewer note: ${s.review_note}`, italics: true, color: "6B7080" })] }));
    if (s.file) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `File: ${s.file.name}`, color: "6B7080", size: 18 })] }),
        new Paragraph({ children: [new TextRun({ text: `SHA-256: ${s.file.sha256}`, font: "Consolas", color: "6B7080", size: 16 })] })
      );
    }
  });
  if (comments.length) {
    children.push(new Paragraph({ text: `Discussion (${comments.length})`, heading: HeadingLevel.HEADING_2 }));
    for (const c of comments) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `${c.author_name || "former member"} · ${fmt(c.created_at)}`, bold: true })] }),
        new Paragraph({ text: c.message })
      );
    }
  }
  children.push(
    new Paragraph({ text: "" }),
    new Paragraph({ children: [new TextRun({ text: `Exported ${fmt(new Date())} by ${exportedBy}.`, italics: true, color: "888888", size: 16 })] })
  );

  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="task-${task.id}-${slug(task.title)}.docx"`);
  res.send(buffer);
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function tasksToCsv(rows) {
  const cols = ["id", "key", "title", "project_name", "status", "type", "priority", "labels", "estimate", "channel", "assignee_name", "due_date", "created_at", "completed_at", "is_overdue"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c] instanceof Date ? r[c].toISOString() : Array.isArray(r[c]) ? r[c].join(" ") : r[c])).join(","))].join("\n");
}
