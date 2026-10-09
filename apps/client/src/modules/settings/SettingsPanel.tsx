/**
 * SettingsPanel — storage, language, device identity and manual sync.
 *
 * This is the only screen that talks about connectivity, because the rest of
 * the app must feel identical online and offline. Pending/synced counts read
 * from the local queue so the numbers are always truthful, even offline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearAllData, countPending, countSynced, estimateStorage, getLessons } from '../../db/client';
import { redownloadContent } from '../../db/seed';
import { installedContentVersion } from '../../content/client';
import { createTranslator, SUPPORTED_LOCALES, type LocaleCode } from '../../i18n';
import { getSyncEngine, type SyncResult } from '../../sync/syncEngine';
import { getDeviceId } from '../../sync/deviceId';
import { isSoundEnabled, setSoundEnabled } from '../../gamification/sfx';
import { FONT_STEPS } from '../../appearance';
import { imageToAvatarDataUrl } from '../../avatar';
import type { SessionUser } from '../../auth/client';
import { LanguagePicker } from './LanguagePicker';

export interface SettingsPanelProps {
  locale: LocaleCode;
  onLocaleChange: (locale: LocaleCode) => void;
  onDataReset: () => void;
  user: SessionUser;
  fontSize: number;
  onFontSizeChange: (scale: number) => void;
  onAvatarChange: (dataUrl: string | null) => void;
}

interface QueueCounts {
  pending: number;
  synced: number;
  usageBytes: number;
  quotaBytes: number;
}

export function SettingsPanel({
  locale,
  onLocaleChange,
  onDataReset,
  user,
  fontSize,
  onFontSizeChange,
  onAvatarChange,
}: SettingsPanelProps) {
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
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const [contentVersion, setContentVersion] = useState(0);
  const [contentLessons, setContentLessons] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement | null>(null);

  const fontStepIndex = Math.max(
    0,
    FONT_STEPS.findIndex((s) => Math.abs(s - fontSize) < 0.02),
  );

  const changeFontSize = useCallback(
    (delta: number) => {
      const next = FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, fontStepIndex + delta))];
      if (next !== undefined) onFontSizeChange(next);
    },
    [fontStepIndex, onFontSizeChange],
  );

  const pickAvatar = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setAvatarBusy(true);
      try {
        const dataUrl = await imageToAvatarDataUrl(file);
        onAvatarChange(dataUrl); // null when it could not be decoded
      } finally {
        setAvatarBusy(false);
      }
    },
    [onAvatarChange],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [version, lessons] = await Promise.all([
        installedContentVersion(),
        getLessons().then((l) => l.length),
      ]);
      if (!cancelled) {
        setContentVersion(version);
        setContentLessons(lessons);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadContent = useCallback(async () => {
    setDownloading(true);
    try {
      const result = await redownloadContent();
      setContentVersion(await installedContentVersion());
      setContentLessons(result.lessons);
    } finally {
      setDownloading(false);
    }
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
  }, [soundOn]);

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
        <LanguagePicker locale={locale} onLocaleChange={onLocaleChange} />
      </section>

      <section className="panel">
        <h2>{t('settings.profile_picture')}</h2>
        <div className="avatar-row">
          <span className="avatar-preview session-avatar">
            {user.avatarUrl ? (
              <img className="session-avatar-img" src={user.avatarUrl} alt="" />
            ) : (
              <span aria-hidden="true">{user.role === 'teacher' ? '🧑‍🏫' : '🎒'}</span>
            )}
          </span>
          <div className="avatar-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={avatarBusy}
              onClick={() => avatarInput.current?.click()}
            >
              {avatarBusy ? '…' : t('settings.change_picture')}
            </button>
            {user.avatarUrl && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onAvatarChange(null)}
              >
                {t('settings.remove_picture')}
              </button>
            )}
            <input
              ref={avatarInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void pickAvatar(e.target.files?.[0])}
            />
          </div>
        </div>
        <p className="muted">{t('settings.picture_hint')}</p>
      </section>

      <section className="panel">
        <h2>{t('settings.font_size')}</h2>
        <div className="fontsize-row" role="group" aria-label={t('settings.font_size')}>
          <button
            type="button"
            className="btn btn-ghost fontsize-btn"
            onClick={() => changeFontSize(-1)}
            disabled={fontStepIndex <= 0}
            aria-label={t('settings.text_smaller')}
          >
            𝐴⁻
          </button>
          <span className="fontsize-preview">Aa</span>
          <button
            type="button"
            className="btn btn-ghost fontsize-btn"
            onClick={() => changeFontSize(1)}
            disabled={fontStepIndex >= FONT_STEPS.length - 1}
            aria-label={t('settings.text_bigger')}
          >
            𝐴⁺
          </button>
        </div>
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
        <p className="muted">
          Curriculum v{contentVersion}
          {contentLessons > 0 ? ` · ${contentLessons} lessons on this device` : ' · no lessons yet'}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void downloadContent()}
          disabled={downloading}
        >
          {downloading ? 'Downloading…' : 'Download lessons'}
        </button>
      </section>

      <section className="panel">
        <h2>{t('settings.sound')}</h2>
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={soundOn}
            onChange={toggleSound}
          />
          <span>{t('settings.sound')}</span>
        </label>
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
