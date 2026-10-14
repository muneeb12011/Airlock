// Outgoing email. Configure with SMTP_URL (smtps://user:pass@smtp.host:465)
// and MAIL_FROM. With MAIL_TRANSPORT=log, mails are printed instead of sent
// (useful in development). With neither, email is simply disabled and the
// app falls back to one-time passwords handed over by an admin.
import nodemailer from "nodemailer";
import { config } from "../config.js";

let transport = null;
export const sentMail = []; // last few messages, for tests and the log transport

if (process.env.SMTP_URL) {
  transport = nodemailer.createTransport(process.env.SMTP_URL);
} else if (process.env.MAIL_TRANSPORT === "log") {
  if (config.isProd) {
    // Printing emails would put live password-reset links in your logs.
    console.warn("[mail] MAIL_TRANSPORT=log is ignored in production. Set SMTP_URL to send email.");
  } else {
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
}

export const emailEnabled = () => Boolean(transport);

export const appUrl = (path = "") => `${(process.env.APP_URL || config.frontendOrigins[0] || "http://localhost:5173").replace(/\/$/, "")}${path}`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function layout({ heading, body, cta, ctaUrl, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#e7ebee;font-family:Arial,Helvetica,sans-serif;color:#17202a">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d3d9de;border-radius:10px">
<tr><td style="padding:28px 32px 8px;font-weight:bold;font-size:16px;color:#0e5f50">${escapeHtml(config.appName)}</td></tr>
<tr><td style="padding:8px 32px;font-size:22px;font-weight:bold">${escapeHtml(heading)}</td></tr>
<tr><td style="padding:8px 32px 16px;font-size:15px;line-height:1.55;color:#3c4854">${body}</td></tr>
${cta ? `<tr><td style="padding:4px 32px 24px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#0e5f50;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:7px">${escapeHtml(cta)}</a></td></tr>` : ""}
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#8a96a1;border-top:1px solid #e4e8eb">${footer || "You're receiving this because you have an account in this workspace."}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendMail({ to, subject, heading, text, cta, ctaUrl, footer }) {
  if (!transport) return false;
  const html = layout({ heading: heading || subject, body: escapeHtml(text).replace(/\n/g, "<br>"), cta, ctaUrl, footer });
  const plain = `${heading || subject}\n\n${text}${ctaUrl ? `\n\n${cta}: ${ctaUrl}` : ""}`;
  try {
    const info = await transport.sendMail({
      from: process.env.MAIL_FROM || `${config.appName} <no-reply@localhost>`,
      to,
      subject,
      text: plain,
      html,
    });
    sentMail.push({ to, subject, text: plain, at: new Date() });
    if (sentMail.length > 50) sentMail.shift();
    if (process.env.MAIL_TRANSPORT === "log" && !process.env.SMTP_URL && process.env.NODE_ENV !== "test") {
      console.log(`[mail] to=${to} subject="${subject}"\n${plain}\n`);
    }
    return Boolean(info);
  } catch (err) {
    console.error("[mail] send failed:", err.message);
    return false;
  }
}
