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

test("server-renders the R1 rules engine status", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>古战阵 · Web 游戏开发<\/title>/i);
  assert.match(html, /RULES ENGINE · R1/);
  assert.match(html, /先把规则做成可信赖的系统/);
  assert.match(html, /0\.2\.0-r1/);
  assert.match(html, /NEXT · R2/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
