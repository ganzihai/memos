import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { D1DatabaseService } from '@/lib/d1';
import { D1ApiClient } from '@/lib/d1-api';
import { usePasswordAuth } from './PasswordAuthContext';
import { getDeletedMemoTombstones, removeDeletedMemoTombstones } from '@/lib/utils';
import largeFileStorage from '@/lib/largeFileStorage';
import { toast } from 'sonner';

const SettingsContext = createContext();
const isSelfHosted = String(import.meta.env.VITE_SELF_HOSTED || '').toLowerCase() === 'true';

export function useSettings() {
  return useContext(SettingsContext);
}

// ─── 工具：把 D1 返回的原始行转换为前端 memo 对象 ───────────────────────────
function rowToMemo(row) {
  return {
    // FIX: id 统一为字符串，与前端 normalizeMemo 保持一致，防止严格比较失效
    id:           String(row.memo_id),
    content:      row.content || '',
    tags:         tryParse(row.tags,        []),
    backlinks:    tryParse(row.backlinks,   []),
    audioClips:   tryParse(row.audio_clips, []),
    is_public:    row.is_public  === 1 || row.is_public  === true,
    is_pinned:    row.is_pinned  === 1 || row.is_pinned  === true,
    pinnedAt:     row.pinned_at  || null,
    createdAt:    row.created_at || new Date().toISOString(),
    updatedAt:    row.updated_at || new Date().toISOString(),
    timestamp:    row.created_at || new Date().toISOString(),
    lastModified: row.updated_at || new Date().toISOString(),
  };
}

function tryParse(str, fallback) {
  if (Array.isArray(str)) return str;
  try { return JSON.parse(str || 'null') ?? fallback; } catch { return fallback; }
}

// ─── 把本地 memos + pinnedMemos 合并为单一数组（兼容旧格式） ─────────────────
export function mergeLegacyStore() {
  try {
    const memos  = tryParse(localStorage.getItem('memos'),        []);
    const pinned = tryParse(localStorage.getItem('pinnedMemos'),  []);
    const map = new Map();
    for (const m of (Array.isArray(memos) ? memos : [])) {
      // FIX: Map key 和存储的 id 均统一为字符串
      map.set(String(m.id), { ...m, id: String(m.id), is_pinned: m.is_pinned || m.isPinned || false });
    }
    for (const m of (Array.isArray(pinned) ? pinned : [])) {
      const existing = map.get(String(m.id));
      map.set(String(m.id), { ...(existing || {}), ...m, id: String(m.id), is_pinned: true });
    }
    return Array.from(map.values());
  } catch {
    return [];
  }
}

// ─── 持久化单一数组到 localStorage ──────────────────────────────────────────
export function persistMemos(memos) {
  if (!Array.isArray(memos)) return;
  localStorage.setItem('memos', JSON.stringify(memos));
  const pinned = memos.filter(m => m.is_pinned);
  localStorage.setItem('pinnedMemos', JSON.stringify(pinned));
}

export function SettingsProvider({ children }) {
  const { isAuthenticated } = usePasswordAuth();

  const [hitokotoConfig, setHitokotoConfig] = useState({ enabled: false, types: ['a','b','c','d','i','j','k'] });
  const [fontConfig, setFontConfig] = useState({ selectedFont: 'kongshan', fontSize: 14 });
  const [backgroundConfig, setBackgroundConfig] = useState({ imageUrl: '', brightness: 50, blur: 10, useRandom: false });
  const [avatarConfig, setAvatarConfig] = useState({ imageUrl: '' });
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(() => isSelfHosted);
  const [aiConfig, setAiConfig] = useState({ baseUrl: '', apiKey: '', model: 'gpt-3.5-turbo', enabled: false });
  const [s3Config, setS3Config] = useState({ enabled: false, endpoint: '', accessKeyId: '', secretAccessKey: '', bucket: '', region: 'auto', publicUrl: '', provider: 'r2' });
  const [keyboardShortcuts, setKeyboardShortcuts] = useState({ toggleSidebar: 'Tab', openAIDialog: 'Ctrl+Space', openSettings: 'Ctrl+,', toggleCanvasMode: 'Ctrl+/', openDailyReview: 'Ctrl+\\' });

  const [syncTimerId, setSyncTimerId] = useState(null);
  const syncingRef = useRef(false);
  const pendingRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  const dispatchDataChanged = (detail = {}) => {
    try { window.dispatchEvent(new CustomEvent('app:dataChanged', { detail })); } catch {}
  };

  // ── 核心同步函数 ─────────────────────────────────────────────────────────────
  const doSync = useCallback(async () => {
    if (!cloudSyncEnabled || !isAuthenticated) return;
    if (syncingRef.current) { pendingRef.current = true; return; }

    const now = Date.now();
    if (now - lastSyncAtRef.current < 5000) {
      if (!pendingRef.current) {
        pendingRef.current = true;
        setTimeout(() => { if (pendingRef.current) { pendingRef.current = false; doSync(); } }, 5000 - (now - lastSyncAtRef.current));
      }
      return;
    }

    syncingRef.current = true;
    lastSyncAtRef.current = now;

    try {
      // ── 1. 拉取远端数据 ────────────────────────────────────────────────────
      let cloudRows = [];
      try {
        const res = await D1ApiClient.restoreUserData();
        if (res?.success) cloudRows = res.data?.memos || [];
      } catch {
        try { cloudRows = await D1DatabaseService.getAllMemos() || []; } catch {}
      }
      const cloudMemos = cloudRows.map(rowToMemo);

      // ── 2. 读取本地（单一数组） ────────────────────────────────────────────
      const local = mergeLegacyStore();
      const tombstones = getDeletedMemoTombstones();
      const deletedSet = new Set((tombstones || []).map(t => String(t.id)));
      const lastSyncAt = Number(localStorage.getItem('lastCloudSyncAt') || 0);

      // ── 3. 三路合并：双向取最新
      const localMap = new Map(local.map(m => [String(m.id), m]));
      const cloudMap = new Map(cloudMemos.map(m => [String(m.id), m]));
      const merged   = new Map();

      for (const [id, lm] of localMap) {
        if (deletedSet.has(id)) continue;
        merged.set(id, lm);
      }

      for (const [id, cm] of cloudMap) {
        if (deletedSet.has(id)) continue;
        const lm = merged.get(id);
        if (!lm) {
          merged.set(id, cm);
        } else {
          const lTime = new Date(lm.updatedAt || lm.lastModified || 0).getTime();
          const cTime = new Date(cm.updatedAt || cm.lastModified || 0).getTime();
          merged.set(id, cTime >= lTime ? { ...lm, ...cm } : lm);
        }
      }

      for (const [id, lm] of localMap) {
        if (!cloudMap.has(id) && !deletedSet.has(id) && lastSyncAt > 0) {
          const lTime = new Date(lm.updatedAt || lm.createdAt || 0).getTime();
          if (lastSyncAt - lTime > 30000) merged.delete(id);
        }
      }

      const mergedArr = Array.from(merged.values())
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      // ── 4. 写回本地 ───────────────────────────────────────────────────────
      persistMemos(mergedArr);
      dispatchDataChanged({ part: 'sync.downmerge' });

      // ── 5. 推送本地到远端（上行） ──────────────────────────────────────────
      try {
        await D1ApiClient.syncUserData({
          memos:      mergedArr,
          themeColor:       localStorage.getItem('themeColor')       || '#969696',
          darkMode:         localStorage.getItem('darkMode')         || 'false',
          hitokotoConfig:   tryParse(localStorage.getItem('hitokotoConfig'),   { enabled: true }),
          fontConfig:       tryParse(localStorage.getItem('fontConfig'),       { selectedFont: 'default' }),
          backgroundConfig: tryParse(localStorage.getItem('backgroundConfig'), { imageUrl: '', brightness: 50, blur: 10, useRandom: false }),
          avatarConfig:     tryParse(localStorage.getItem('avatarConfig'),     { imageUrl: '' }),
          canvasConfig:     tryParse(localStorage.getItem('canvasState'),      null),
          s3Config:         tryParse(localStorage.getItem('s3Config'),         { enabled: false }),
        });
      } catch (e) {
        console.warn('doSync upload failed:', e);
        try { await D1DatabaseService.syncUserData(); } catch {}
      }

      // ── 6. 处理删除墓碑 ───────────────────────────────────────────────────
      const stones = getDeletedMemoTombstones();
      if (stones?.length) {
        const results = await Promise.allSettled(
          stones.map(t => D1ApiClient.deleteMemo(t.id).catch(() => D1DatabaseService.deleteMemo(t.id).catch(() => {})))
        );
        const succeeded = stones.filter((_, i) => results[i].status === 'fulfilled');
        if (succeeded.length) removeDeletedMemoTombstones(succeeded.map(t => t.id));
      }

      localStorage.setItem('lastCloudSyncAt', String(Date.now()));
    } finally {
      syncingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        clearTimeout(syncTimerId);
        setTimeout(doSync, 500);
      }
    }
  }, [cloudSyncEnabled, isAuthenticated, syncTimerId]);

  const scheduleSync = useCallback((reason = 'change') => {
    if (!cloudSyncEnabled) return;
    const since = Date.now() - lastSyncAtRef.current;
    const delay = since < 1500 ? 800 : 200;
    setSyncTimerId(prev => {
      if (prev) clearTimeout(prev);
      const id = setTimeout(() => {
        doSync();
        setSyncTimerId(null);
      }, delay);
      return id;
    });
  }, [cloudSyncEnabled, doSync]);

  // ── 启动时恢复数据 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      try {
        if (isAuthenticated) {
          const savedSync = localStorage.getItem('cloudSyncEnabled');
          if (savedSync !== 'false') {
            localStorage.setItem('cloudSyncEnabled', 'true');
            setCloudSyncEnabled(true);
          }
          if (sessionStorage.getItem('justLoggedIn') === 'true') {
            sessionStorage.removeItem('justLoggedIn');
            localStorage.setItem('cloudSyncEnabled', 'true');
            setCloudSyncEnabled(true);
          }
        }

        let res = null;
        try {
          res = isAuthenticated
            ? await D1ApiClient.restoreUserData()
            : await D1ApiClient.getPublicData();
        } catch {}

        if (!res?.success) return;

        const s = res.data?.settings;
        if (s) {
          if (s.theme_color)       { localStorage.setItem('themeColor', s.theme_color); window.dispatchEvent(new CustomEvent('app:themeColorChanged', { detail: s.theme_color })); }
          if (s.dark_mode != null)  localStorage.setItem('darkMode', s.dark_mode.toString());
          if (s.hitokoto_config)   { localStorage.setItem('hitokotoConfig',   s.hitokoto_config);   try { setHitokotoConfig(JSON.parse(s.hitokoto_config)); }   catch {} }
          if (s.font_config)       { localStorage.setItem('fontConfig',       s.font_config);       try { setFontConfig(JSON.parse(s.font_config)); }           catch {} }
          if (s.background_config) { localStorage.setItem('backgroundConfig', s.background_config); try { setBackgroundConfig(JSON.parse(s.background_config)); } catch {} }
          if (s.avatar_config)     { localStorage.setItem('avatarConfig',     s.avatar_config);     try { setAvatarConfig(JSON.parse(s.avatar_config)); }       catch {} }
          if (s.canvas_config)     localStorage.setItem('canvasState',   s.canvas_config);
          if (s.s3_config)         { localStorage.setItem('s3Config',     s.s3_config);     try { setS3Config(JSON.parse(s.s3_config)); }        catch {} }
          localStorage.setItem('cloudSyncEnabled', 'true');
          setCloudSyncEnabled(true);
        }

        const cloudRows = res.data?.memos || [];
        if (cloudRows.length > 0) {
          const cloudMemos = cloudRows.map(rowToMemo);
          const local      = mergeLegacyStore();
          const tombstones = getDeletedMemoTombstones();
          const deletedSet = new Set((tombstones || []).map(t => String(t.id)));

          if (local.length > 0) {
            const localMap = new Map(local.map(m => [String(m.id), m]));
            for (const cm of cloudMemos) {
              if (deletedSet.has(String(cm.id))) continue;
              const lm = localMap.get(String(cm.id));
              if (!lm) {
                localMap.set(String(cm.id), cm);
              } else {
                const lTime = new Date(lm.updatedAt || 0).getTime();
                const cTime = new Date(cm.updatedAt || 0).getTime();
                if (cTime >= lTime) localMap.set(String(cm.id), { ...lm, ...cm });
              }
            }
            const merged = Array.from(localMap.values())
              .filter(m => !deletedSet.has(String(m.id)))
              .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            persistMemos(merged);
          } else {
            const pinnedIdsFromSettings = new Set(
              tryParse(s?.pinned_memos, []).map(p => String(p?.id ?? p))
            );
            const withPinned = cloudMemos.map(m => ({
              ...m,
              is_pinned: m.is_pinned || pinnedIdsFromSettings.has(String(m.id)),
            }));
            persistMemos(withPinned);
          }

          dispatchDataChanged({ part: 'restore.d1.api' });
        } else if (res.data?.settings?.pinned_memos) {
          const pinnedIds = new Set(
            tryParse(res.data.settings.pinned_memos, []).map(p => String(p?.id ?? p))
          );
          const local = mergeLegacyStore();
          if (local.length > 0) {
            const fixed = local.map(m => ({ ...m, is_pinned: m.is_pinned || pinnedIds.has(String(m.id)) }));
            persistMemos(fixed);
            dispatchDataChanged({ part: 'restore.d1.api' });
          }
        }

        if (isAuthenticated) scheduleSync('post-restore');
      } catch (e) {
        console.error('restore failed:', e);
      }
    };

    restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // 游客模式定期刷新
  const refreshPublicData = React.useCallback(async () => {
    if (isAuthenticated) return;
    try {
      const res = await D1ApiClient.getPublicData();
      if (!res?.success) return;
      const newMemos = (res.data?.memos || []).map(rowToMemo);
      if (newMemos.length === 0) return;
      const cur = tryParse(localStorage.getItem('memos'), []);
      const curIds = new Set(cur.map(m => String(m.id)));
      const hasNew = newMemos.some(m => !curIds.has(String(m.id)));
      if (hasNew) {
        persistMemos(newMemos);
        dispatchDataChanged({ part: 'guest.refresh' });
      }
    } catch {}
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) return;
    refreshPublicData();
    const id = setInterval(refreshPublicData, 2 * 60 * 1000);
    window.addEventListener('focus', refreshPublicData);
    return () => { clearInterval(id); window.removeEventListener('focus', refreshPublicData); };
  }, [isAuthenticated, refreshPublicData]);

  // ── 监听 dataChanged 事件，触发同步 ─────────────────────────────────────────
  useEffect(() => {
    if (!cloudSyncEnabled) return;
    const handler = (e) => {
      const part = e?.detail?.part || '';
      if (part.startsWith('sync.') || part.startsWith('restore.') || part === 'guest.refresh') return;
      scheduleSync('event');
    };
    window.addEventListener('app:dataChanged', handler);
    return () => window.removeEventListener('app:dataChanged', handler);
  }, [cloudSyncEnabled, scheduleSync]);

  // ── 从 localStorage 加载各项配置 ─────────────────────────────────────────────
  useEffect(() => {
    const load = (key, setter, fallback) => {
      try { const v = localStorage.getItem(key); if (v) setter(JSON.parse(v)); } catch {}
    };
    load('hitokotoConfig',   (v) => setHitokotoConfig(v),   null);
    load('fontConfig',       (v) => setFontConfig({ selectedFont: 'default', fontSize: 16, ...v }), null);
    load('backgroundConfig', (v) => setBackgroundConfig({ imageUrl: '', brightness: 50, blur: 10, useRandom: false, ...v }), null);
    load('avatarConfig',     (v) => setAvatarConfig(v),     null);
    load('aiConfig',         (v) => setAiConfig(v),         null);
    load('keyboardShortcuts',(v) => setKeyboardShortcuts(v),null);
    load('s3Config',         (v) => setS3Config(v),         null);
    if (isSelfHosted) {
      setCloudSyncEnabled(true);
      localStorage.setItem('cloudSyncEnabled', 'true');
    } else {
      try { const v = localStorage.getItem('cloudSyncEnabled'); if (v) setCloudSyncEnabled(JSON.parse(v)); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 持久化各项配置 ────────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem('hitokotoConfig',    JSON.stringify(hitokotoConfig));    dispatchDataChanged({ part: 'hitokoto' });   }, [hitokotoConfig]);
  useEffect(() => { localStorage.setItem('fontConfig',        JSON.stringify(fontConfig));        dispatchDataChanged({ part: 'font' });       }, [fontConfig]);
  useEffect(() => { localStorage.setItem('avatarConfig',      JSON.stringify(avatarConfig));      dispatchDataChanged({ part: 'avatar' });     }, [avatarConfig]);
  useEffect(() => { localStorage.setItem('aiConfig',          JSON.stringify(aiConfig));          dispatchDataChanged({ part: 'ai' });         }, [aiConfig]);
  useEffect(() => { localStorage.setItem('keyboardShortcuts', JSON.stringify(keyboardShortcuts));                                              }, [keyboardShortcuts]);
  useEffect(() => {
    if (isSelfHosted) { localStorage.setItem('cloudSyncEnabled', 'true'); return; }
    localStorage.setItem('cloudSyncEnabled', JSON.stringify(cloudSyncEnabled));
  }, [cloudSyncEnabled, isSelfHosted]);

  // 背景配置（大图走 IndexedDB）
  useEffect(() => {
    const persist = async () => {
      try {
        const cfg = backgroundConfig || {};
        const isDataUrl = typeof cfg.imageUrl === 'string' && cfg.imageUrl.startsWith('');
        const tooLarge  = isDataUrl && cfg.imageUrl.length > 100_000;
        let toSave = { ...cfg };
        if (tooLarge) {
          if (!toSave.imageRef?.id) {
            try {
              const match = /^(.*?);base64,(.*)$/.exec(cfg.imageUrl || '');
              const mime  = match ? match[1] : 'image/png';
              const stored = await largeFileStorage.storeFile({ name: 'background-image', size: 0, type: mime,  data: cfg.imageUrl });
              toSave.imageRef = { id: stored.id, type: mime, storedAt: new Date().toISOString() };
            } catch {}
          }
          toSave.imageUrl = '';
        }
        try { localStorage.setItem('backgroundConfig', JSON.stringify(toSave)); }
        catch (err) {
          if (String(err?.name || err).includes('QuotaExceededError')) {
            try { localStorage.setItem('backgroundConfig', JSON.stringify({ ...toSave, imageUrl: '' })); toast.error('本地存储空间不足，已停止缓存大图'); } catch {}
          }
        }
      } finally { dispatchDataChanged({ part: 'background' }); }
    };
    persist();
  }, [backgroundConfig]);

  useEffect(() => {
    const recover = async () => {
      try {
        const ref = backgroundConfig?.imageRef;
        if (!ref || backgroundConfig?.imageUrl) return;
        const file = await largeFileStorage.getFile(ref.id);
        if (file?.data) setBackgroundConfig(prev => ({ ...prev, imageUrl: file.data }));
      } catch {}
    };
    recover();
  }, [backgroundConfig?.imageRef, backgroundConfig?.imageUrl]);

  useEffect(() => {
    localStorage.setItem('s3Config', JSON.stringify(s3Config));
    dispatchDataChanged({ part: 's3' });
    try {
      if (s3Config?.enabled) import('@/lib/s3Storage').then(m => { try { m.default.init(s3Config); } catch {} }).catch(() => {});
    } catch {}
  }, [s3Config]);

  // ── 手动同步 / D1 操作（供设置页调用） ──────────────────────────────────────
  const manualSync     = async () => { try { await doSync(); return { success: true }; } catch (e) { return { success: false, message: e?.message }; } };
  const syncToD1       = async () => manualSync();
  const restoreFromD1  = async () => {
    try {
      const res = await D1ApiClient.restoreUserData();
      if (!res?.success) throw new Error(res?.message || '恢复失败');
      const cloudMemos = (res.data?.memos || []).map(rowToMemo);
      const pinnedIdsFromSettings = new Set(tryParse(res.data?.settings?.pinned_memos, []).map(p => String(p?.id ?? p)));
      const withPinned = cloudMemos.map(m => ({ ...m, is_pinned: m.is_pinned || pinnedIdsFromSettings.has(String(m.id)) }));
      persistMemos(withPinned);
      dispatchDataChanged({ part: 'restore.manual' });
      return { success: true, message: '恢复成功，请刷新页面' };
    } catch (e) {
      return { success: false, message: e?.message };
    }
  };

  return (
    <SettingsContext.Provider value={{
      isSelfHosted,
      hitokotoConfig,    updateHitokotoConfig:    (v) => setHitokotoConfig(p => ({ ...p, ...v })),
      fontConfig,        updateFontConfig:        (v) => setFontConfig(p => ({ ...p, ...v })),
      backgroundConfig,  updateBackgroundConfig:  (v) => setBackgroundConfig(p => ({ ...p, ...v })),
      avatarConfig,      updateAvatarConfig:      (v) => setAvatarConfig(p => ({ ...p, ...v })),
      cloudSyncEnabled,  updateCloudSyncEnabled:  (v) => { if (!isSelfHosted) setCloudSyncEnabled(v); },
      aiConfig,          updateAiConfig:          (v) => setAiConfig(p => ({ ...p, ...v })),
      keyboardShortcuts, updateKeyboardShortcuts: (v) => setKeyboardShortcuts(p => ({ ...p, ...v })),
      s3Config,          updateS3Config:          setS3Config,
      syncToD1,
      restoreFromD1,
      manualSync,
      refreshPublicData,
      _scheduleCloudSync: scheduleSync,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}
