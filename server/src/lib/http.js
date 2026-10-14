// Small helpers for consistent JSON errors. Express 5 forwards rejected
// promises from async handlers to the error middleware automatically.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = "Not signed in", extra) => new HttpError(401, msg, extra);
export const forbidden = (msg = "You don't have access to this", extra) => new HttpError(403, msg, extra);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

// Validates `data` against a zod schema; throws a 400 with the first issue.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join(".");
    throw badRequest(field ? `${field}: ${issue.message}` : issue.message, {
      code: "VALIDATION",
      field,
    });
  }
  return result.data;
}

export function intParam(value, name = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}
