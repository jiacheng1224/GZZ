import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the M16-H main menu without hand identities", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>烽垒九章 · 六旌竞势<\/title>/i);
  assert.match(html, /M16-H · MAIN COMMAND/);
  assert.match(html, /2\.8\.0-m16h/);
  assert.match(html, /data-content-pack="beacon-ramparts-zh-cn"/);
  assert.match(html, /标准对局/);
  assert.match(html, /基础对局/);
  assert.match(html, /引导对局/);
  assert.match(html, /单人对 AI/);
  assert.match(html, /在线房间/);
  assert.match(html, /部署令/);
  assert.match(html, /选择战局/);
  assert.match(html, /世界观/);
  assert.match(html, /开始本地对战/);
  assert.match(html, /data-testid="game-setup"/);
  assert.doesNotMatch(html, /data-testid="hand-card"/);
  assert.doesNotMatch(html, /troop-(red|orange|yellow|green|blue|purple)-/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
