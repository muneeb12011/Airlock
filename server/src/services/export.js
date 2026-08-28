import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

// Streams a PDF of the task + submission straight to the HTTP response
export function generateTaskPDF(task, submission, res) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="task-${task.id}-${slug(task.title)}.pdf"`
  );
  doc.pipe(res);

  doc.fontSize(20).text(task.title, { underline: true });
  doc.moveDown();
  doc.fontSize(11).fillColor("#555").text(`Status: ${task.status}`);
  doc.text(`Assigned to: ${task.assignee_name || task.assigned_to}`);
  doc.text(`Due date: ${task.due_date || "N/A"}`);
  doc.moveDown();

  doc.fillColor("#000").fontSize(13).text("Description", { bold: true });
  doc.fontSize(11).text(task.description || "No description provided.");
  doc.moveDown();

  doc.fontSize(13).text("Submission Notes");
  doc.fontSize(11).text(submission?.notes || "No notes submitted.");
  doc.moveDown();

  if (submission?.submitted_at) {
    doc
      .fontSize(10)
      .fillColor("#888")
      .text(`Submitted at: ${new Date(submission.submitted_at).toLocaleString()}`);
  }

  doc.end();
}

// Builds a DOCX buffer of the task + submission and sends it
export async function generateTaskDocx(task, submission, res) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: task.title, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `Status: ${task.status}` }),
          new Paragraph({ text: `Assigned to: ${task.assignee_name || task.assigned_to}` }),
          new Paragraph({ text: `Due date: ${task.due_date || "N/A"}` }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Description", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: task.description || "No description provided." }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Submission Notes", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: submission?.notes || "No notes submitted." }),
          new Paragraph({ text: "" }),
          submission?.submitted_at
            ? new Paragraph({
                children: [
                  new TextRun({
                    text: `Submitted at: ${new Date(
                      submission.submitted_at
                    ).toLocaleString()}`,
                    italics: true,
                    color: "888888",
                  }),
                ],
              })
            : new Paragraph({ text: "" }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="task-${task.id}-${slug(task.title)}.docx"`
  );
  res.send(buffer);
}

function slug(text) {
  return (text || "task").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
