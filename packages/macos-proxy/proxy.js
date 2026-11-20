import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { ProxyAgent } from 'undici';

const run = promisify(execFile);

// scutil's HTTPSProxy is an HTTP CONNECT proxy for HTTPS destinations.
export function macProxyForHost(settings, hostname) {
  const field = (key) => settings.match(new RegExp('^\\s*' + key + ' : (.+)$', 'm'))?.[1]?.trim();
  if (field('HTTPSEnable') !== '1' || field('ProxyAutoConfigEnable') === '1' || field('ProxyAutoDiscoveryEnable') === '1') return;
  const exceptions = settings.match(/ExceptionsList : <array> \{([^}]*)\}/)?.[1] ?? '';
  for (const [, pattern] of exceptions.matchAll(/^\s*\d+ : (.+)$/gm)) {
    const escaped = pattern.trim().split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp('^' + escaped + '$', 'i').test(hostname)) return;
  }
  const host = field('HTTPSProxy');
  const port = Number(field('HTTPSPort'));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return;
  if (isIP(host) === 6) return 'http://[' + host + ']:' + port;
  if (/^[\w.-]+$/.test(host)) return 'http://' + host + ':' + port;
}

export async function systemProxy(hostname, signal) {
  if (process.platform !== 'darwin') return;
  // DSH's global dispatcher owns explicit proxy and bypass environment settings.
  if (Object.keys(process.env).some(key => /^(https?|all|no)_proxy$/i.test(key) && process.env[key])) return;
  const settings = await run('/usr/sbin/scutil', ['--proxy'], { signal, timeout: 2000 }).catch(() => undefined);
  signal.throwIfAborted();
  const url = settings && macProxyForHost(settings.stdout, hostname);
  if (url) return new ProxyAgent(url);
}
