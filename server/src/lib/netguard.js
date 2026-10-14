// Blocks server-side requests to private or internal addresses (SSRF), so a
// webhook URL can't be pointed at the database, cloud metadata service or
// anything else inside your network.
import dns from "dns/promises";
import net from "net";

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  if (url.protocol !== "https:" && !(process.env.ALLOW_HTTP_WEBHOOKS === "true" && url.protocol === "http:")) {
    throw new Error("Webhook URLs must use https://");
  }
  if (url.username || url.password) throw new Error("Put credentials in the signing secret, not the URL.");
  if (process.env.ALLOW_PRIVATE_WEBHOOKS === "true") return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error("That host doesn't resolve.");
  if (addrs.some(isPrivate)) throw new Error("Webhooks can't target private or internal network addresses.");
  return url;
}
