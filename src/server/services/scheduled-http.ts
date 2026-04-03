import type { NextRequest } from "next/server";

export function isAuthorizedScheduledRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const authorization = request.headers.get("authorization");
  const bearerToken =
    authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;
  const headerSecret = request.headers.get("x-cron-secret");

  return bearerToken === secret || headerSecret === secret;
}

export function parseOptionalExecutionDate(value: string | null, fallback: Date | null = new Date()) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
