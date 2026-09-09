import { describe, expect, it } from 'vitest';
import { FakeProvider } from './fake';
import type { ProviderChatEvent } from './types';

async function collect(iter: AsyncIterable<ProviderChatEvent>): Promise<ProviderChatEvent[]> {
  const out: ProviderChatEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

describe('FakeProvider', () => {
  const request = {
    model: 'fake-standard',
    messages: [{ role: 'user' as const, content: 'How do I deploy a Solidity contract?' }],
  };

  it('streams deltas and reports usage last', async () => {
    const provider = new FakeProvider({ reply: 'hello world', chunkSize: 5 });
    const events = await collect(provider.stream(request));

    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe(
      'hello world',
    );
    expect(events.at(-1)?.type).toBe('usage');
  });

  it('stops promptly when the caller aborts', async () => {
    const controller = new AbortController();
    const provider = new FakeProvider({ reply: 'a'.repeat(500), chunkSize: 10, delayMs: 1 });

    const events: ProviderChatEvent[] = [];
    for await (const event of provider.stream({ ...request, signal: controller.signal })) {
      events.push(event);
      if (events.length === 2) controller.abort();
    }

    expect(events.length).toBeLessThan(10);
  });

  it('returns null classification when none is configured', async () => {
    const provider = new FakeProvider();
    const result = await provider.classify({
      model: 'fake-fast',
      system: 's',
      input: 'i',
      toolName: 'classify_intent',
      toolDescription: 'd',
      jsonSchema: {},
      parse: (v) => v,
    });
    expect(result).toBeNull();
  });

  it('runs the caller parser over a configured classification', async () => {
    const provider = new FakeProvider({ classification: { intent: 'bug_fixing' } });
    const result = await provider.classify<{ intent: string }>({
      model: 'fake-fast',
      system: 's',
      input: 'i',
      toolName: 'classify_intent',
      toolDescription: 'd',
      jsonSchema: {},
      parse: (v) => v as { intent: string },
    });
    expect(result).toEqual({ intent: 'bug_fixing' });
  });
});
