import { fetch as proxyFetch } from 'undici';
import { systemProxy } from './proxy.js';

// Both discovery and pi-ai's xAI Responses client use this request-local transport.
export const fetchGrok: typeof fetch = async (input, init) => {
  const request = new Request(input, { ...init, redirect: 'error' });
  const { origin, hostname } = new URL(request.url);
  if (origin !== 'https://api.x.ai') throw new Error('Unexpected xAI origin');
  const dispatcher = await systemProxy(hostname, request.signal);
  if (!dispatcher) return fetch(request);
  try {
    const response = await proxyFetch(request.url, {
      dispatcher, method: request.method, headers: Array.from(request.headers),
      body: request.body ? await request.arrayBuffer() : undefined,
      redirect: 'error', signal: request.signal,
    });
    // Node and undici expose the same WHATWG response; their lib.dom and
    // node:stream/web declarations differ for the underlying byte stream.
    return response as unknown as Response;
  } finally {
    // close() drains the outstanding SSE response before releasing the tunnel.
    void dispatcher.close().catch(() => dispatcher.destroy()).catch(() => {});
  }
};
