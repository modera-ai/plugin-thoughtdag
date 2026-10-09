import { makeNode, type ImportableConversation } from './import-chat';
import { autoLayout } from './layout';
import type { ThoughtEdge, ThoughtNode } from '../types';

type BridgeResult = { id: string; value?: unknown; error?: string };
type Page = { title?: string; messages?: { id: string; role: string; text: string }[]; nextCursor?: string | null };
type Catalog = { conversations?: { id: string; title: string }[]; nextCursor?: string | null };
type Frontend = { action(id: string, value?: string): Promise<{ view: { data?: { bridgeResult?: BridgeResult } } }> };
const frontend = (window as Window & { moderaPlugin?: Frontend }).moderaPlugin;

async function read(kind: 'conversations' | 'conversation', sessionId?: string, cursor?: string): Promise<unknown> {
  if (!frontend) throw new Error('Modera frontend unavailable');
  const id = crypto.randomUUID();
  const response = await frontend.action('bridge.history', JSON.stringify({ id, kind, sessionId, cursor }));
  const result = response.view.data?.bridgeResult;
  if (result?.id !== id) throw new Error('Modera history response changed');
  if (result.error) throw new Error(result.error);
  return result.value;
}

export async function moderaConversations(): Promise<ImportableConversation[]> {
  const entries: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const value = await read('conversations', undefined, cursor) as Catalog;
    entries.push(...(value.conversations ?? []));
    if (!value.nextCursor) break;
    cursor = value.nextCursor;
  }
  return Promise.all(entries.map(async entry => {
    const messages: NonNullable<Page['messages']> = [];
    let next: string | undefined;
    for (let page = 0; page < 100; page++) {
      const value = await read('conversation', entry.id, next) as Page;
      messages.push(...(value.messages ?? []));
      if (!value.nextCursor) break;
      next = value.nextCursor;
    }
    return {
      title: entry.title, source: 'modera' as const, sessionId: entry.id, messageCount: messages.length,
      build: () => {
        const nodes: ThoughtNode[] = [];
        const edges: ThoughtEdge[] = [];
        let pending: { id: string; text: string } | undefined;
        for (const message of messages) {
          if (message.role === 'user') pending = { id: message.id, text: message.text };
          else if (message.role === 'assistant' && pending) {
            const node = makeNode(pending.text, message.text, nodes.length === 0);
            node.data.importSource = { runner: 'modera', sessionId: entry.id, itemIds: [pending.id, message.id] };
            const previous = nodes.at(-1);
            if (previous) edges.push({ id: `edge-${previous.id}-${node.id}`, source: previous.id, target: node.id, type: 'smoothstep', sourceHandle: 'continue', targetHandle: 'top', data: {} });
            nodes.push(node);
            pending = undefined;
          }
        }
        return { nodes: autoLayout(nodes, edges), edges };
      },
    } satisfies ImportableConversation;
  }));
}
