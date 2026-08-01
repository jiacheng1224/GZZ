import { describe, expect, it, vi } from "vitest";
import {
  chooseAiCommand,
  createCommandEnvelope,
  type PlayerId,
  type ProtocolSnapshot,
} from "../packages/game-core/src";
import { handleRoomApi } from "./room-api";
import { MemoryRoomRepository } from "./room-repository";

const post = (path: string, body: unknown, token?: string) =>
  new Request(`https://load.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("R6 HTTP authority load", () => {
  it("completes 12 two-client matches through the transport with retry and reconnect", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    for (let game = 0; game < 12; game += 1) {
      let now = 1_000;
      let byte = game * 7;
      const dependencies = {
        repository: new MemoryRoomRepository(),
        now: () => now++,
        randomBytes: (length: number) =>
          Uint8Array.from({ length }, () => (byte++ * 31 + 19) % 256),
      };
      const created = await handleRoomApi(
        post("/api/rooms", { seed: `http-load-${game}` }),
        dependencies,
      );
      const host = await created!.json<{
        room: { roomId: string; inviteCode: string };
        session: { token: string };
      }>();
      const joined = await handleRoomApi(
        post("/api/rooms/join", { inviteCode: host.room.inviteCode }),
        dependencies,
      );
      const guest = await joined!.json<{ session: { token: string } }>();
      const tokens: Record<PlayerId, string> = {
        "player-one": host.session.token,
        "player-two": guest.session.token,
      };
      for (const player of ["player-one", "player-two"] as const)
        await handleRoomApi(
          post(
            `/api/rooms/${host.room.roomId}/actions`,
            { action: "ready", ready: true },
            tokens[player],
          ),
          dependencies,
        );

      let status = "playing";
      let step = 0;
      while (status === "playing" && step < 500) {
        const stored = await dependencies.repository.findById(host.room.roomId);
        const player = stored!.room.authority!.state.activePlayer;
        if (step > 0 && step % 37 === 0) {
          await handleRoomApi(
            post(
              `/api/rooms/${host.room.roomId}/actions`,
              { action: "disconnect" },
              tokens[player],
            ),
            dependencies,
          );
          const restored = await handleRoomApi(
            post(
              `/api/rooms/${host.room.roomId}/actions`,
              { action: "reconnect" },
              tokens[player],
            ),
            dependencies,
          );
          expect(restored?.status).toBe(200);
        }
        const synced = await handleRoomApi(
          new Request(`https://load.test/api/rooms/${host.room.roomId}`, {
            headers: { authorization: `Bearer ${tokens[player]}` },
          }),
          dependencies,
        );
        const syncBody = await synced!.json<{
          snapshot: ProtocolSnapshot;
        }>();
        const decision = chooseAiCommand(syncBody.snapshot.snapshot, {
          difficulty: "standard",
          seed: `http-ai-${game}`,
          decisionIndex: step,
        });
        const envelope = createCommandEnvelope({
          roomId: host.room.roomId,
          commandId: `game-${game}-command-${step}`,
          sequence: syncBody.snapshot.nextSequence,
          playerId: player,
          clientVersion: "2.0.0-r6.rc1",
          expectedStateVersion: syncBody.snapshot.stateVersion,
          command: decision.command,
        });
        const submit = () =>
          handleRoomApi(
            post(
              `/api/rooms/${host.room.roomId}/actions`,
              { action: "command", envelope },
              tokens[player],
            ),
            dependencies,
          );
        const accepted = await submit();
        const acceptedBody = await accepted!.json<{
          room: { status: string };
          result: { status: string };
        }>();
        expect(acceptedBody.result.status).toBe("accepted");
        status = acceptedBody.room.status;
        if (step > 0 && step % 23 === 0) {
          const repeated = await submit();
          const repeatedBody = await repeated!.json<{
            result: { status: string };
          }>();
          expect(repeatedBody.result.status).toBe("duplicate");
        }
        step += 1;
      }
      expect(status, `HTTP match ${game} did not finish`).toBe("finished");
      expect(step).toBeLessThan(500);
    }

    info.mockRestore();
    error.mockRestore();
  });
});
