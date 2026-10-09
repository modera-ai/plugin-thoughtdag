import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "../upstream/node_modules/playwright-core/index.mjs";

const root = resolve(import.meta.dirname, "../dist/ui");
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + sep)) throw new Error("Outside frontend root");
    response.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.moderaPlugin = {
      requestConversation: async input => {
        if (input.workspaceKey !== "thoughtdag") throw new Error("Wrong workspace");
        window.lastNativeQuestion = input.content;
        return { sessionId: "native-session" };
      },
      action: async (_action, value) => ({ view: { data: { bridgeResult: { id: JSON.parse(value).id, value: { messages: [{ role: "user", text: "Question" }, { role: "assistant", text: "Native answer" }], run: { status: "completed" } } } } } }),
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator(".react-flow").first().waitFor({ timeout: 15000 });
  const bridge = await page.evaluate(async () => {
    const models = await fetch("/api/models").then(response => response.json());
    const stream = await fetch("/api/stream", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Question" }] }) }).then(response => response.text());
    return { models, stream, question: window.lastNativeQuestion };
  });
  if (bridge.models.default !== "modera/native" || !bridge.stream.includes("Native answer") || bridge.question !== "Question") throw new Error("Modera model/history bridge did not answer");
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`ThoughtDAG SPA and Modera model/history bridge rendered in browser: ${await page.title()}\n`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
