import type { ProxyAgent } from 'undici';
export function macProxyForHost(settings: string, hostname: string): string | undefined;
export function systemProxy(hostname: string, signal: AbortSignal): Promise<ProxyAgent | undefined>;
