import crypto from "crypto";
// SHA-1 is only used for the HIBP range lookup format, never for security.
export const sha1Hex = (s) => crypto.createHash("sha1").update(String(s)).digest("hex");
