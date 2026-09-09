import { useSettingsStore } from '../store/settings';
import zhCN from './zh-CN.json';

export type Locale = 'en' | 'zh-CN';
export function resolveLocale(preference: string, system = typeof navigator === 'undefined' ? 'en' : navigator.language): Locale {
  return preference === 'zh-CN' || (preference === 'auto' && /^zh\b/i.test(system)) ? 'zh-CN' : 'en';
}
export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const text = locale === 'zh-CN' ? (zhCN as Record<string, string>)[key] ?? key : key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
}
/** Call at presentation boundaries only: document contents and paths remain untouched. */
export function t(key: string, values?: Record<string, string | number>): string {
  return translate(resolveLocale(useSettingsStore.getState().settings.ui_language), key, values);
}
export function useLocale(): Locale {
  return resolveLocale(useSettingsStore(s => s.settings.ui_language));
}
