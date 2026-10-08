/**
 * SettingsPanel — storage, language, device identity and manual sync.
 *
 * This is the only screen that talks about connectivity, because the rest of
 * the app must feel identical online and offline. Pending/synced counts read
 * from the local queue so the numbers are always truthful, even offline.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearAllData, countPending, countSynced, estimateStorage } from '../../db/client';
import { createTranslator, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n';
import { getSyncEngine, type SyncResult } from '../../sync/syncEngine';
import { getDeviceId } from '../../sync/deviceId';

export interface SettingsPanelProps {
  locale: LocaleCode;
  onLocaleChange: (locale: LocaleCode) => void;
  onDataReset: () => void;
}

interface QueueCounts {
  pending: number;
  synced: number;
  usageBytes: number;
  quotaBytes: number;
}

export function SettingsPanel({ locale, onLocaleChange, onDataReset }: SettingsPanelProps) {
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const [counts, setCounts] = useState<QueueCounts>({
    pending: 0,
    synced: 0,
    usageBytes: 0,
    quotaBytes: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  const refreshCounts = useCallback(async () => {
    const [pending, synced, storage] = await Promise.all([
      countPending().catch(() => 0),
      countSynced().catch(() => 0),
      estimateStorage().catch(() => ({ usageBytes: 0, quotaBytes: 0 })),
    ]);
    setCounts({
      pending,
      synced,
      usageBytes: storage.usageBytes,
      quotaBytes: storage.quotaBytes,
    });
  }, []);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    const engine = getSyncEngine();
    const unsubscribe = engine.onResult((result) => {
      setLastResult(result);
      void refreshCounts();
    });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refreshCounts]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await getSyncEngine().run();
      await refreshCounts();
    } finally {
      setSyncing(false);
    }
  }, [refreshCounts]);

  const resetData = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm(t('settings.reset_confirm'))) return;
    await clearAllData();
    onDataReset();
    await refreshCounts();
  }, [onDataReset, refreshCounts, t]);

  const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="settings">
      <h1>{t('nav.settings')}</h1>

      <section className="panel">
        <h2>{t('settings.language')}</h2>
        <label className="field">
          <span className="sr-only">{t('settings.language')}</span>
          <select
            value={locale}
            onChange={(event) => onLocaleChange(event.target.value as LocaleCode)}
          >
            {SUPPORTED_LOCALES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel">
        <h2>{t('sync.now')}</h2>
        <p className={online ? 'muted' : 'muted warn'}>
          {online ? t('common.online') : t('sync.offline_note')}
        </p>
        <p className="muted" role="status">
          {counts.pending > 0 ? t('sync.pending', { count: counts.pending }) : t('sync.synced')}
        </p>
        {lastResult && !lastResult.ok && <p className="error">{t('sync.failed')}</p>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={syncing || !online}
          onClick={() => void syncNow()}
        >
          {syncing ? t('sync.syncing') : t('sync.now')}
        </button>
      </section>

      <section className="panel">
        <h2>{t('settings.storage')}</h2>
        <p className="muted">
          {formatBytes(counts.usageBytes)}
          {counts.quotaBytes > 0 ? ` / ${formatBytes(counts.quotaBytes)}` : ''}
        </p>
        <p className="muted">
          {counts.pending} pending · {counts.synced} synced
        </p>
      </section>

      <section className="panel">
        <h2>{t('settings.student')}</h2>
        <p className="muted mono">{getDeviceId()}</p>
      </section>

      <section className="panel danger">
        <button type="button" className="btn btn-danger" onClick={() => void resetData()}>
          {t('settings.reset')}
        </button>
      </section>
    </div>
  );
}

export default SettingsPanel;
