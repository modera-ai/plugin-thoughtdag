// Adapt the existing ThoughtDAG SPA's proxy protocol to Modera's native
// conversation workbench. This module only installs inside a Modera frontend.
type BridgeResult = { id: string; value?: unknown; error?: string };
type ModeraFrontend = {
  requestConversation(input: { workspaceKey: string; content: string; contextInput: string; references: []; modelId?: string }): Promise<{ sessionId: string }>;
  listModels(): Promise<readonly { id: string; name: string; provider: string; vision: boolean }[]>;
  action(id: string, value?: string): Promise<{ view: { data?: { bridgeResult?: BridgeResult } } }>;
  snapshot(): Promise<{ conversation?: { sessionId: string; live?: { text: string; thinking: string }; run?: { status: string }; messages: { role: string; text: string }[] } }>;
};

const frontend = (window as Window & { moderaPlugin?: ModeraFrontend }).moderaPlugin;
if (frontend) {
  const originalFetch = window.fetch.bind(window);
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const history = async (sessionId: string): Promise<{ messages?: { role: string; text: string }[]; run?: { status: string } }> => {
    const id = crypto.randomUUID();
    const snapshot = await frontend.action('bridge.history', JSON.stringify({ id, kind: 'conversation', sessionId }));
    const result = snapshot.view.data?.bridgeResult;
    if (result?.id !== id) throw new Error('History bridge response changed');
    if (result.error) throw new Error(result.error);
    return (result.value ?? {}) as { messages?: { role: string; text: string }[]; run?: { status: string } };
  };
  const questionOf = (body: unknown): string => {
    const messages = (body as { messages?: { role: string; content: string }[] })?.messages;
    return [...(messages ?? [])].reverse().find(item => item.role === 'user')?.content?.trim() ?? '';
  };
  const contextOf = (body: unknown): string => {
    const messages = (body as { messages?: { role: string; content: string }[] })?.messages ?? [];
    const content = questionOf(body);
    let latestUser = -1;
    messages.forEach((item, index) => { if (item.role === 'user') latestUser = index; });
    const previous = messages.filter((item, index) => index !== latestUser && typeof item.content === 'string');
    return previous.length ? `${content}\n\n[ThoughtDAG context]\n${previous.map(item => `<${item.role}>\n${item.content}\n</${item.role}>`).join('\n\n')}` : content;
  };
  const modelOf = (body: unknown): string | undefined => {
    const id = (body as { model?: unknown })?.model;
    return typeof id === 'string' && id !== 'modera/native' ? id : undefined;
  };
  const answer = async (body: unknown, signal?: AbortSignal): Promise<{ text: string; sessionId: string }> => {
    const content = questionOf(body);
    if (!content) throw new Error('A question is required');
    const receipt = await frontend.requestConversation({ workspaceKey: 'thoughtdag', content, contextInput: contextOf(body), references: [], ...(modelOf(body) ? { modelId: modelOf(body) } : {}) });
    for (let attempt = 0; attempt < 240; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const transcript = await history(receipt.sessionId);
      const status = transcript.run?.status;
      const text = (transcript.messages ?? []).filter(item => item.role === 'assistant').at(-1)?.text ?? '';
      if (status === 'completed' || (!status && text)) return { text, sessionId: receipt.sessionId };
      if (status === 'failed' || status === 'cancelled') throw new Error(`Native run ${status}`);
      await sleep(500);
    }
    throw new Error('Native run is still active; open its conversation to inspect the result');
  };
  const streamAnswer = (body: unknown, signal?: AbortSignal): Response => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        try {
          const content = questionOf(body);
          if (!content) throw new Error('A question is required');
          const receipt = await frontend.requestConversation({ workspaceKey: 'thoughtdag', content, contextInput: contextOf(body), references: [], ...(modelOf(body) ? { modelId: modelOf(body) } : {}) });
          let emitted = '';
          let reasoning = '';
          send({ harnessSession: receipt.sessionId });
          for (let attempt = 0; attempt < 600; attempt++) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const snapshot = await frontend.snapshot();
            const current = snapshot.conversation?.sessionId === receipt.sessionId ? snapshot.conversation : undefined;
            if (current) {
              const liveText = current.live?.text ?? '';
              if (liveText.startsWith(emitted) && liveText.length > emitted.length) {
                send({ text: liveText.slice(emitted.length) });
                emitted = liveText;
              }
              const liveThinking = current.live?.thinking ?? '';
              if (liveThinking.startsWith(reasoning) && liveThinking.length > reasoning.length) {
                send({ reasoning: liveThinking.slice(reasoning.length) });
                reasoning = liveThinking;
              }
              if (current.run?.status === 'failed' || current.run?.status === 'cancelled') throw new Error(`Native run ${current.run.status}`);
              if (current.run?.status === 'completed') {
                const final = current.messages.filter(item => item.role === 'assistant').at(-1)?.text ?? '';
                if (final.startsWith(emitted) && final.length > emitted.length) send({ text: final.slice(emitted.length) });
                else if (!emitted && final) send({ text: final });
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }
            }
            await sleep(200);
          }
          throw new Error('Native run is still active; open its conversation to inspect the result');
        } catch (cause) {
          if (!signal?.aborted) send({ error: cause instanceof Error ? cause.message : String(cause) });
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (url.pathname === '/api/models') {
      const models = await frontend.listModels();
      return json({ models, default: models[0]?.id ?? null, capabilities: { webSearch: false, searchEngine: 'none', scholarSearch: false, vision: false } });
    }
    if (url.pathname !== '/api/stream' && url.pathname !== '/api/claude') return originalFetch(input, init);
    try {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.pathname === '/api/stream') return streamAnswer(body, init?.signal ?? undefined);
      const result = await answer(body, init?.signal ?? undefined);
      return json({ text: result.text, model: 'modera/native' });
    } catch (cause) {
      return json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
    }
  };
}
