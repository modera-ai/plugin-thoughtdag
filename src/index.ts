export const activate = async (host: any) => {
  const results = new Map<string, { id: string; value?: unknown; error?: string }>();
  return ({
  ui: [{
    id: "modera.thoughtdag.workbench",
    slot: "workbench",
    frontend: "workbench",
    workbench: { title: "ThoughtDAG", icon: "waypoints", order: -105, locales: { "zh-CN": { title: "思维画布" } } },
    conversationView: { title: "ThoughtDAG", placement: "workbench", nativeRequests: true, canvasOnly: true, locales: { "zh-CN": { title: "思维画布" } } },
    requiredPermissions: ["history.read", "storage.read", "storage.write", "models.generate"],
    actions: ["bridge.history"],
    async render(_request: unknown, context: { projectId?: string }) {
      return { title: "ThoughtDAG", conversationView: { workspaceKey: "thoughtdag", hasContent: true }, data: { bridgeResult: context.projectId ? results.get(context.projectId) : undefined }, children: [] };
    },
    async act(action: { id: string; value?: string }, context: { projectId?: string; signal: AbortSignal }) {
      if (action.id !== "bridge.history" || !context.projectId || !host.history) throw new Error("ThoughtDAG history bridge unavailable");
      const input = JSON.parse(action.value ?? "{}");
      if (typeof input.id !== "string" || input.id.length > 100 || !["conversations", "conversation"].includes(input.kind)) throw new Error("Invalid history request");
      if (input.kind === "conversation" && (typeof input.sessionId !== "string" || input.sessionId.length > 200)) throw new Error("Invalid conversation identity");
      try {
        const value = await host.history.execute(input.kind === "conversations" ? { action: "conversations", ...(input.cursor ? { cursor: input.cursor } : {}) } : { action: "conversation", sessionId: input.sessionId, ...(input.cursor ? { cursor: input.cursor } : {}) }, context);
        results.set(context.projectId, { id: input.id, value });
      } catch (cause) { results.set(context.projectId, { id: input.id, error: String(cause) }); }
    },
  }],
  });
};
