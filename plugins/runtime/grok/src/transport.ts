import type { LlmFailure } from '@deepseek-ai/dsh-llm';
import { fetch as proxyFetch } from 'undici';
import { connectionFailure } from './model-network-failure.js';
import { systemProxy } from './proxy.js';

// Both discovery and pi-ai's xAI Responses client use this request-local transport.
export async function fetchGrok(input: Parameters<typeof fetch>[0], init?: RequestInit,
  onConnectionFailure?: (failure: LlmFailure) => void, beforeInferenceDispatch?: () => void): Promise<Response> {
  const request = new Request(input, { ...init, redirect: 'error' });
  const { origin, hostname, pathname } = new URL(request.url);
  if (origin !== 'https://api.x.ai') throw new Error('Unexpected xAI origin');
  const inference = request.method === 'POST' && pathname === '/v1/responses';
  const dispatcher = await systemProxy(hostname, request.signal);
  function beforeDispatch() {
    if (inference) beforeInferenceDispatch?.();
    request.signal.throwIfAborted();
  }
  function failed(error: unknown): never {
    if (onConnectionFailure && inference && !request.signal.aborted) {
      const failure = connectionFailure(error);
      if (failure) onConnectionFailure(failure.failure);
    }
    throw error;
  }
  if (!dispatcher) {
    beforeDispatch();
    try { return await fetch(request); }
    catch (error) { return failed(error); }
  }
  try {
    const body = request.body ? await request.arrayBuffer() : undefined;
    beforeDispatch();
    try {
      const response = await proxyFetch(request.url, {
        dispatcher, method: request.method, headers: Array.from(request.headers), body,
        redirect: 'error', signal: request.signal,
      });
      // Node and undici expose the same WHATWG response; their lib.dom and
      // node:stream/web declarations differ for the underlying byte stream.
      return response as unknown as Response;
    } catch (error) { return failed(error); }
  } finally {
    // close() drains the outstanding SSE response before releasing the tunnel.
    void dispatcher.close().catch(() => dispatcher.destroy()).catch(() => {});
  }
}
