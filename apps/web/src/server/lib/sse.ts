import { encodeSSE, type ChatStreamEvent } from '@aam/shared';

/**
 * Server-sent events for the chat endpoint.
 *
 * The response must be returned to the client immediately and filled in
 * afterwards, otherwise the first token waits for the whole answer. Everything
 * that produces events therefore runs inside start(), and the headers disable
 * every layer of buffering between here and the extension.
 */

export interface SSEStream {
  response: Response;
  send: (event: ChatStreamEvent) => void;
  close: () => void;
  /** True once the client has gone away, so producers can stop early. */
  readonly closed: boolean;
}

export function createSSEStream(signal?: AbortSignal): SSEStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      controller = null;
    },
  });

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controller?.close();
    } catch {
      // Already closed by the client disconnecting; nothing to do.
    }
    controller = null;
  };

  signal?.addEventListener('abort', close);

  return {
    response: new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Without this a reverse proxy will hold the stream until it completes.
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
    }),
    send(event) {
      if (closed || !controller) return;
      try {
        controller.enqueue(encoder.encode(encodeSSE(event)));
      } catch {
        closed = true;
      }
    },
    close,
    get closed() {
      return closed;
    },
  };
}
