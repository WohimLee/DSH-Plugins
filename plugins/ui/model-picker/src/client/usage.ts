import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-deepseek-account/types';
import type { ProviderUsage } from '../remote.js';

type T = PropsLocale<'modelPicker'>['t'];
type Wallet = NonNullable<ProviderUsage['wallets']>[number];
export type Usage = ProviderUsage;
export type ReadUsage = (provider: string, signal: AbortSignal) => Promise<Usage | null>;

const weeklyMinutes = 7 * 24 * 60;
const creditLabels = ['plan', 'addOn', 'organization'] as const;

export function createReadUsage(ctx: Context): ReadUsage {
  return async (provider, signal) => {
    if (provider === 'deepseek-account') {
      const account = ctx.get('remote.account');
      if (!account) return null;
      const result = await account.getBalance({
        locale: ctx.locale.getSnapshot().active, version: '0.2.2-rc.5',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      });
      if (!result.ok || result.value?.status !== 'ready') return null;
      return { wallets: result.value.value, bonus: result.value.bonusWallets };
    }
    if (provider !== 'codex' && provider !== 'qoder'
      && !provider.startsWith('codex-account-') && !provider.startsWith('qoder-account-')
      && !provider.startsWith('deepseek-api-account-')) return null;
    const result = await ctx.remote.dshModelPickerUsage.read(provider, signal);
    return result.ok ? result.value : null;
  };
}

export function usagePercent(data: Usage): number | undefined {
  if (data.wallets) return undefined;
  const windows = data.windows ?? [];
  const window = windows.find(window => window.minutes === weeklyMinutes) ?? windows[0];
  if (window) return window.remainingPercent;

  for (const label of creditLabels) {
    const quota = data.credits?.[label];
    if (quota?.total) return Math.min(100, 100 * quota.remaining / quota.total);
  }
  return undefined;
}

export function usageDetails(data: Usage, t: T, language: string, includeReset = true): string[] {
  if (data.wallets) {
    return [...data.wallets.map(wallet => `${t('balance')} ${walletText(wallet, language)}`),
      ...(data.bonus ?? []).map(wallet => `${t('bonus')} ${walletText(wallet, language)}`)];
  }
  const format = new Intl.NumberFormat(language);
  const windows = data.windows ?? [];
  const primary = windows.find(window => window.minutes === weeklyMinutes) ?? windows[0];
  return [
    ...(includeReset ? windows : primary ? [primary] : []).map(window => {
      const date = !includeReset || window.resetsAt === undefined ? undefined : new Date(window.resetsAt * 1000);
      const reset = date && Number.isFinite(date.valueOf())
        ? ` · ${t('resets')} ${new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(date)}` : '';
      return `${windowText(window.minutes, t, language)} · ${t('left', { value: `${window.remainingPercent}%` })}${reset}`;
    }),
    ...creditLabels.flatMap(label => {
      const quota = data.credits?.[label];
      if (!quota) return [];
      const value = `${format.format(quota.remaining)}${quota.total === undefined ? '' : ` / ${format.format(quota.total)}`} ${t('credits')}`;
      return [`${t(label)} · ${t('left', { value })}`];
    }),
  ];
}

function walletText(wallet: Wallet, language: string): string {
  const value = Number(wallet.balance);
  return Number.isFinite(value) && /^[A-Z]{3}$/.test(wallet.currency)
    ? new Intl.NumberFormat(language, { style: 'currency', currency: wallet.currency, maximumFractionDigits: 4 }).format(value)
    : `${wallet.balance} ${wallet.currency}`;
}

function windowText(minutes: number, t: T, language: string): string {
  if (minutes === weeklyMinutes) return t('weekly');
  if (!minutes) return t('window');
  const unit = minutes % 1440 === 0 ? 'day' : minutes % 60 === 0 ? 'hour' : 'minute';
  return new Intl.NumberFormat(language, { style: 'unit', unit }).format(minutes / (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1));
}
