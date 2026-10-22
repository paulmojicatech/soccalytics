import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Minimal Server-Sent Events helper. Hijacks the reply so Fastify doesn't
 * serialise it, but keeps headers set by hooks (CORS, request id).
 */
export function openSse(req: FastifyRequest, reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
  let closed = false;
  const onClose: (() => void)[] = [];
  req.raw.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    onClose.forEach((f) => f());
  });
  return {
    get closed() {
      return closed;
    },
    send(data: unknown, event?: string) {
      if (closed) return;
      reply.raw.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (closed) return;
      clearInterval(heartbeat);
      reply.raw.write('event: end\ndata: {}\n\n');
      reply.raw.end();
      closed = true;
    },
    onClose: (f: () => void) => onClose.push(f),
  };
}
