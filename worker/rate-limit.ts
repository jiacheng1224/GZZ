export type RoomRateLimitOperation = "create" | "join" | "action";

export interface RoomRateLimiter {
  allow(
    operation: RoomRateLimitOperation,
    request: Request,
    now: number,
  ): Promise<boolean>;
}

const POLICIES: Record<
  RoomRateLimitOperation,
  { readonly limit: number; readonly windowMs: number }
> = {
  create: { limit: 12, windowMs: 60_000 },
  join: { limit: 30, windowMs: 60_000 },
  action: { limit: 180, windowMs: 60_000 },
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function requestActor(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "local-preview";
  const authorization = request.headers.get("authorization") ?? "anonymous";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${address}:${authorization}`),
  );
  return base64Url(new Uint8Array(digest));
}

export class D1RoomRateLimiter implements RoomRateLimiter {
  constructor(private readonly database: D1Database) {}

  async allow(
    operation: RoomRateLimitOperation,
    request: Request,
    now: number,
  ): Promise<boolean> {
    const policy = POLICIES[operation];
    const bucket = Math.floor(now / policy.windowMs);
    const actor = await requestActor(request);
    const bucketKey = `${operation}:${bucket}:${actor}`;
    const row = await this.database
      .prepare(
        `INSERT INTO room_rate_limits (bucket_key, request_count, expires_at)
         VALUES (?, 1, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET
           request_count = request_count + 1
         RETURNING request_count`,
      )
      .bind(bucketKey, (bucket + 2) * policy.windowMs)
      .first<{ request_count: number }>();
    return (row?.request_count ?? policy.limit + 1) <= policy.limit;
  }

  async deleteExpired(now: number): Promise<number> {
    const result = await this.database
      .prepare("DELETE FROM room_rate_limits WHERE expires_at <= ?")
      .bind(now)
      .run();
    return result.meta.changes ?? 0;
  }
}
