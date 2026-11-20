import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readJson, record } from './local.js';

const versionPattern = /^\d+\.\d+\.\d+$/;
const modelFields = [
  'slug', 'visibility', 'supported_in_api', 'display_name', 'context_window', 'max_context_window',
  'description', 'input_modalities', 'effective_context_window_percent', 'supports_image_detail_original',
  'default_reasoning_level', 'supported_reasoning_levels', 'default_reasoning_summary', 'default_verbosity', 'service_tiers',
];

function versionOrder(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true });
}

function snapshot(value: unknown) {
  const { client_version, fetched_at, models } = record(value);
  if (typeof client_version !== 'string' || !versionPattern.test(client_version)
    || typeof fetched_at !== 'string' || !Number.isFinite(Date.parse(fetched_at)) || !Array.isArray(models)) return;
  return { client_version, fetched_at, models };
}

export class ModelCache {
  private accountId?: string;
  private accepted?: NonNullable<ReturnType<typeof snapshot>>;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly codexHome: string, private readonly snapshotRoot?: string) {}

  read(accountId: string): Promise<unknown> {
    const result = this.pending.then(() => this.refresh(accountId));
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async refresh(accountId: string): Promise<unknown> {
    const live = await readJson(join(this.codexHome, 'models_cache.json'));
    const directory = this.snapshotRoot && join(this.snapshotRoot, createHash('sha256')
      .update(JSON.stringify([resolve(this.codexHome), accountId])).digest('hex'));
    if (this.accountId !== accountId) {
      this.accountId = accountId;
      this.accepted = directory ? await this.loadSnapshot(directory) : undefined;
    }

    const current = snapshot(live);
    if (!current) return Array.isArray(record(live).models) ? live : this.accepted;
    if (this.accepted) {
      const comparison = versionOrder(current.client_version, this.accepted.client_version);
      if (comparison < 0 || (comparison === 0 && Date.parse(current.fetched_at) <= Date.parse(this.accepted.fetched_at))) {
        return this.accepted;
      }
    }
    this.accepted = current;
    if (directory) await this.saveSnapshot(directory, current);
    return current;
  }

  private async loadSnapshot(directory: string) {
    const files = await readdir(directory).catch(() => []);
    const versions = files.filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))
      .filter(version => versionPattern.test(version)).sort((left, right) => versionOrder(right, left));
    for (const version of versions) {
      const data = snapshot(await readJson(join(directory, `${version}.json`)));
      if (data?.client_version === version) return data;
    }
  }

  private async saveSnapshot(directory: string, current: NonNullable<ReturnType<typeof snapshot>>): Promise<void> {
    const temp = join(directory, `${randomUUID()}.tmp`);
    try {
      const models = current.models.map(value => {
        const model = record(value);
        return Object.fromEntries(modelFields.filter(key => Object.hasOwn(model, key)).map(key => [key, model[key]]));
      });
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temp, JSON.stringify({ ...current, models }), { mode: 0o600, flag: 'wx' });
      // Each client version has its own file, so a concurrent older writer cannot replace a newer snapshot.
      await rename(temp, join(directory, `${current.client_version}.json`));
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}
