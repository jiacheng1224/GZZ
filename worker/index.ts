/** Cloudflare Worker entry point for the vinext-starter template. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleRoomApi } from "./room-api";
import {
  D1RoomRepository,
  ensureRoomRepositorySchema,
} from "./room-repository";
import { D1RoomRateLimiter } from "./rate-limit";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/rooms")) {
      if (!env.DB)
        return Response.json(
          { error: "ROOM_STORAGE_UNAVAILABLE" },
          { status: 503 },
        );
      await ensureRoomRepositorySchema(env.DB);
      const repository = new D1RoomRepository(env.DB);
      const rateLimiter = new D1RoomRateLimiter(env.DB);
      if (request.method === "POST" && url.pathname === "/api/rooms")
        ctx.waitUntil(
          Promise.all([
            repository.deleteExpired(Date.now(), 50),
            rateLimiter.deleteExpired(Date.now()),
          ]).then(() => undefined),
        );
      return (
        (await handleRoomApi(request, {
          repository,
          rateLimiter,
        })) ?? Response.json({ error: "ROOM_ROUTE_NOT_FOUND" }, { status: 404 })
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await ensureRoomRepositorySchema(env.DB);
    const rooms = new D1RoomRepository(env.DB);
    const limits = new D1RoomRateLimiter(env.DB);
    ctx.waitUntil(
      Promise.all([
        rooms.deleteExpired(Date.now(), 500),
        limits.deleteExpired(Date.now()),
      ]).then(([deletedRooms, deletedLimits]) => {
        console.info(
          JSON.stringify({
            event: "room-cleanup",
            deletedRooms,
            deletedLimits,
          }),
        );
      }),
    );
  },
};

export default worker;
