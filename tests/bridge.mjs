import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { activate } = require("../dist/index.cjs");

const calls = [];
const host = { history: { execute: async (command, context) => {
  calls.push({ command, projectId: context.projectId });
  return { sessionId: command.sessionId, messages: [{ id: "u", role: "user", text: "Question" }, { id: "a", role: "assistant", text: "Answer" }], nextCursor: null, historical: true };
} } };
const module = await activate(host);
const ui = module.ui[0];
const context = { projectId: "p", signal: new AbortController().signal };
assert.equal((await ui.render({}, context)).conversationView.workspaceKey, "thoughtdag");
await ui.act({ id: "bridge.history", value: JSON.stringify({ id: "probe", kind: "conversation", sessionId: "s" }) }, context);
const result = (await ui.render({}, context)).data.bridgeResult;
assert.equal(result.id, "probe");
assert.equal(result.value.messages[1].text, "Answer");
assert.deepEqual(calls, [{ command: { action: "conversation", sessionId: "s" }, projectId: "p" }]);
process.stdout.write("Modera plugin wrapper and scoped history bridge passed\n");
