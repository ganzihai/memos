/**
 * Index.jsx — 彻底重构版 (修复数据重复、类型不一致与异步竞态问题)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import LeftSidebar from '@/components/LeftSidebar';
import RightSidebar from '@/components/RightSidebar';
import MainContent from '@/components/MainContent';
import CanvasMode from '@/components/CanvasMode';
import MobileSidebar from '@/components/MobileSidebar';
import SettingsCard from '@/components/SettingsCard';
import ShareDialog from '@/components/ShareDialog';
import AIButton from '@/components/AIButton';
import AIDialog from '@/components/AIDialog';
import DailyReview from '@/components/DailyReview';
import TutorialDialog from '@/components/TutorialDialog';
import MemoPreviewDialog from '@/components/MemoPreviewDialog';
import MusicModal from '@/components/MusicModal';
import MiniMusicPlayer from '@/components/MiniMusicPlayer';
import MusicSearchCard from '@/components/MusicSearchCard';
import { useSettings } from '@/context/SettingsContext';
import { persistMemos, mergeLegacyStore } from '@/context/SettingsContext';
import { usePasswordAuth } from '@/context/PasswordAuthContext';
import { addDeletedMemoTombstone } from '@/lib/utils';
import { D1ApiClient } from '@/lib/d1-api';
import { toast } from 'sonner';

// ── 工具 ───────────────────────────────────────────────────────────────────────
const normalizeMemo = (m) => ({
  // 【修复点 1】: 强制所有的 ID 无论从何处来，都变为标准的 String，防止严格比较失败
  id:           String(m.id || m.memo_id || m.memoId),
  content:      m.content      || '',
  tags:         Array.isArray(m.tags)       ? m.tags       : [],
  backlinks:    Array.isArray(m.backlinks)  ? m.backlinks.map(String) : [],
  audioClips:   Array.isArray(m.audioClips) ? m.audioClips : [],
  is_public:    typeof m.is_public  === 'boolean' ? m.is_public  : m.is_public  === 1,
  is_pinned:    typeof m.is_pinned  === 'boolean' ? m.is_pinned  : (m.is_pinned === 1 || m.isPinned === true),
  pinnedAt:     m.pinnedAt    || null,
  createdAt:    m.createdAt   || m.timestamp    || new Date().toISOString(),
  updatedAt:    m.updatedAt   || m.lastModified || new Date().toISOString(),
  timestamp:    m.createdAt   || m.timestamp    || new Date().toISOString(),
  lastModified: m.updatedAt   || m.lastModified || new Date().toISOString(),
  canvasX:      typeof m.canvasX === 'number' ? m.canvasX : undefined,
  canvasY:      typeof m.canvasY === 'number' ? m.canvasY : undefined,
});

// 派生属性：置顶 memo 列表
const getPinned  = (memos) => memos.filter(m => m.is_pinned);
const getNormal  = (memos) => memos.filter(m => !m.is_pinned);

// ── 主组件 ─────────────────────────────────────────────────────────────────────
const Index = () => {
  // ─ 单一数据源 ────────────────────────────────────────────────────────────────
  const [memos, setMemosState] = useState([]);
  const memosRef = useRef([]);

  // 所有写操作都通过此函数，确保 ref、state、localStorage 三者同步
  const setMemos = useCallback((updater) => {
    setMemosState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const normalized = next.map(normalizeMemo);
      memosRef.current = normalized;
      persistMemos(normalized);
      return normalized;
    });
  }, []);

  // 便捷：更新单条 memo
  const updateMemo = useCallback((id, patch) => {
    setMemos(prev => prev.map(m => String(m.id) === String(id) ? { ...m, ...patch, updatedAt: new Date().toISOString(), lastModified: new Date().toISOString() } : m));
  }, [setMemos]);

  // ─ UI State ──────────────────────────────────────────────────────────────────
  const [newMemo, setNewMemo]             = useState('');
  const [filteredMemos, setFilteredMemos] = useState([]);
  const [activeTag, setActiveTag]         = useState(null);
  const [activeDate, setActiveDate]       = useState(null);
  const [heatmapData, setHeatmapData]     = useState([]);
  const [activeMenuId, setActiveMenuId]   = useState(null);
  const [editingId, setEditingId]         = useState(null);
  const [editContent, setEditContent]     = useState('');
  const [searchQuery, setSearchQuery]     = useState('');
  const [isSettingsOpen, setIsSettingsOpen]       = useState(false);
  const [isLeftSidebarHidden, setIsLeftSidebarHidden]   = useState(false);
  const [isRightSidebarHidden, setIsRightSidebarHidden] = useState(false);
  const [isLeftSidebarPinned, setIsLeftSidebarPinned]   = useState(true);
  const [isRightSidebarPinned, setIsRightSidebarPinned] = useState(true);
  const [isLeftSidebarHovered, setIsLeftSidebarHovered] = useState(false);
  const [isRightSidebarHovered, setIsRightSidebarHovered] = useState(false);
  const [isAppLoaded, setIsAppLoaded]     = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [selectedMemo, setSelectedMemo]   = useState(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [isAIDialogOpen, setIsAIDialogOpen] = useState(false);
  const [isCanvasMode, setIsCanvasMode]   = useState(false);
  const [canvasToolPanelVisible, setCanvasToolPanelVisible] = useState(false);
  const [isDailyReviewOpen, setIsDailyReviewOpen] = useState(false);
  const [previewMemoId, setPreviewMemoId] = useState(null);
  const [pendingNewBacklinks, setPendingNewBacklinks] = useState([]);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [pendingNewAudioClips, setPendingNewAudioClips] = useState([]);
  const [musicSearchOpen, setMusicSearchOpen]     = useState(false);
  const [musicSearchKeyword, setMusicSearchKeyword] = useState('');
  const [musicModal, setMusicModal] = useState({
    isOpen: false, title: '鲜花',
    musicUrl: 'https://pic.lover.nyc.mn/2025-08/回春丹 - 鲜花_1755699293512.flac',
    cover: '/images/xh.jpg', author: '回春丹', danmakuText: '好听', enableDanmaku: true,
  });
  const [currentRandomBgUrl, setCurrentRandomBgUrl] = useState('');

  // ─ Refs ──────────────────────────────────────────────────────────────────────
  const hoverTimerRef     = useRef(null);
  const menuRefs          = useRef({});
  const searchInputRef    = useRef(null);
  const memosContainerRef = useRef(null);

  // ─ Context ───────────────────────────────────────────────────────────────────
  const { backgroundConfig, updateBackgroundConfig, aiConfig, keyboardShortcuts, musicConfig, _scheduleCloudSync } = useSettings();
  const { isAuthenticated } = usePasswordAuth();

  // ─ 从 localStorage 初始化（含旧格式兼容） ────────────────────────────────────
  useEffect(() => {
    const all = mergeLegacyStore().map(normalizeMemo);
    memosRef.current = all;
    setMemosState(all);

    const isCanvas = (() => { try { return JSON.parse(localStorage.getItem('isCanvasMode') || 'false'); } catch { return false; } })();
    if (isCanvas) {
      setIsCanvasMode(true);
      setIsLeftSidebarPinned(false);
      setIsRightSidebarPinned(false);
    } else {
      try { const v = localStorage.getItem('isLeftSidebarPinned');  if (v !== null) setIsLeftSidebarPinned (JSON.parse(v)); } catch {}
      try { const v = localStorage.getItem('isRightSidebarPinned'); if (v !== null) setIsRightSidebarPinned(JSON.parse(v)); } catch {}
    }
    setTimeout(() => { setIsAppLoaded(true); setIsInitialLoad(false); }, 100);
  }, []);

  // ─ 监听 SettingsContext 恢复/同步事件，刷新本地 state ────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const part = e?.detail?.part || '';
      if (!part.includes('sync.') && !part.includes('restore.') && part !== 'startup') return;
      const fresh = mergeLegacyStore().map(normalizeMemo);
      if (JSON.stringify(fresh.map(m => m.id + m.updatedAt + m.is_pinned)) !==
          JSON.stringify(memosRef.current.map(m => m.id + m.updatedAt + m.is_pinned))) {
        memosRef.current = fresh;
        setMemosState(fresh);
      }
    };
    const storageHandler = (e) => {
      if (e?.key === 'memos') handler({ detail: { part: 'sync.storage' } });
    };
    window.addEventListener('app:dataChanged', handler);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('app:dataChanged', handler);
      window.removeEventListener('storage', storageHandler);
    };
  }, []);

  // ─ sendBeacon 兜底 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    const save = () => { for (const m of memosRef.current) D1ApiClient.beaconUpsertMemo(m); };
    window.addEventListener('pagehide',     save);
    window.addEventListener('beforeunload', save);
    return () => { window.removeEventListener('pagehide', save); window.removeEventListener('beforeunload', save); };
  }, [isAuthenticated]);

  // ─ 移动端滚动锁 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = isMobileSidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobileSidebarOpen]);

  // ─ 侧栏 hover ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let t;
    const h = (e) => {
      if (e.target?.closest?.('.sidebar-hover-block')) return;
      if (canvasToolPanelVisible || isAIDialogOpen || isDailyReviewOpen || document.body.getAttribute('data-music-modal-open') === 'true') return;
      if (!isLeftSidebarPinned) {
        if (e.clientX < 50)  { clearTimeout(t); t = setTimeout(() => setIsLeftSidebarHovered(true),  150); }
        else if (e.clientX > 350 && isLeftSidebarHovered) { clearTimeout(t); t = setTimeout(() => setIsLeftSidebarHovered(false), 200); }
      }
    };
    if (!isLeftSidebarPinned && !isAIDialogOpen && !isDailyReviewOpen) document.addEventListener('mousemove', h);
    return () => { document.removeEventListener('mousemove', h); clearTimeout(t); };
  }, [isLeftSidebarPinned, isLeftSidebarHovered, canvasToolPanelVisible, isAIDialogOpen, isDailyReviewOpen]);

  useEffect(() => {
    let t;
    const h = (e) => {
      if (e.target?.closest?.('.sidebar-hover-block')) return;
      if (isAIDialogOpen || isDailyReviewOpen || document.body.getAttribute('data-music-modal-open') === 'true') return;
      if (!isRightSidebarPinned) {
        if (e.clientX > window.innerWidth - 50) { clearTimeout(t); t = setTimeout(() => setIsRightSidebarHovered(true),  150); }
        else if (e.clientX < window.innerWidth - 350 && isRightSidebarHovered) { clearTimeout(t); t = setTimeout(() => setIsRightSidebarHovered(false), 200); }
      }
    };
    if (!isRightSidebarPinned && !isAIDialogOpen && !isDailyReviewOpen) document.addEventListener('mousemove', h);
    return () => { document.removeEventListener('mousemove', h); clearTimeout(t); };
  }, [isRightSidebarPinned, isRightSidebarHovered, isAIDialogOpen, isDailyReviewOpen]);

  useEffect(() => {
    if (isAIDialogOpen || isDailyReviewOpen) {
      if (!isLeftSidebarPinned)  setIsLeftSidebarHovered(false);
      if (!isRightSidebarPinned) setIsRightSidebarHovered(false);
    }
  }, [isAIDialogOpen, isDailyReviewOpen, isLeftSidebarPinned, isRightSidebarPinned]);

  // ─ 滚动监听 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = memosContainerRef.current;
    if (!el) return;
    const h = () => setShowScrollToTop(el.scrollTop > 200);
    el.addEventListener('scroll', h);
    return () => el.removeEventListener('scroll', h);
  }, []);
  const scrollToTop = () => memosContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  // ─ 持久化侧栏状态 ─────────────────────────────────────────────────────────────
  useEffect(() => { if (!isCanvasMode) localStorage.setItem('isLeftSidebarPinned',  JSON.stringify(isLeftSidebarPinned));  }, [isLeftSidebarPinned,  isCanvasMode]);
  useEffect(() => { if (!isCanvasMode) localStorage.setItem('isRightSidebarPinned', JSON.stringify(isRightSidebarPinned)); }, [isRightSidebarPinned, isCanvasMode]);
  useEffect(() => {
    localStorage.setItem('isCanvasMode', JSON.stringify(isCanvasMode));
    if (isCanvasMode) { setIsLeftSidebarPinned(false); setIsRightSidebarPinned(false); }
  }, [isCanvasMode]);
  useEffect(() => {
    if (isCanvasMode && (isLeftSidebarPinned || isRightSidebarPinned)) {
      setIsLeftSidebarPinned(false); setIsRightSidebarPinned(false);
    }
  }, [isCanvasMode, isLeftSidebarPinned, isRightSidebarPinned]);

  // ─ 首次教程 ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (!localStorage.getItem('hasSeenTutorialV1')) {
        const t = setTimeout(() => setIsTutorialOpen(true), 300);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  // ─ 热力图 ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const countByDate = {};
    const list = isAuthenticated ? memos : memos.filter(m => m.is_public);
    list.forEach(m => {
      const d = (m.createdAt || m.timestamp || '').split('T')[0];
      if (d) countByDate[d] = (countByDate[d] || 0) + 1;
    });
    const today = new Date();
    setHeatmapData(Array.from({ length: 365 }, (_, i) => {
      const dt = new Date(today); dt.setDate(today.getDate() - i);
      const ds = dt.toISOString().split('T')[0];
      return { date: ds, count: countByDate[ds] || 0 };
    }));
  }, [memos, isAuthenticated]);

  // ─ 筛选 ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let base = isAuthenticated ? memos : memos.filter(m => m.is_public);
    if (activeTag)  base = base.filter(m => m.tags?.includes(activeTag) || m.tags?.some(t => t.startsWith(activeTag + '/')));
    if (activeDate) base = base.filter(m => (m.createdAt || m.timestamp || '').split('T')[0] === activeDate);
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      setFilteredMemos(
        base.filter(m => m.content?.toLowerCase().includes(q) || m.tags?.some(t => t.toLowerCase().includes(q)))
      );
    } else {
      setFilteredMemos(base);
    }
  }, [memos, activeTag, activeDate, searchQuery, isAuthenticated]);

  // ─ D1 立即上传辅助 ───────────────────────────────────────────────────────────
  const uploadMemo = useCallback((memo) => {
    if (!isAuthenticated) return;
    D1ApiClient.upsertMemo(memo).catch(e => console.error('upsertMemo failed:', e));
  }, [isAuthenticated]);

  const uploadMemos = useCallback((list) => {
    if (!isAuthenticated || !list?.length) return;
    list.forEach(uploadMemo);
  }, [isAuthenticated, uploadMemo]);

  // ─ 添加 memo ─────────────────────────────────────────────────────────────────
  const addMemo = useCallback(async () => {
    if (!newMemo.trim()) return;
    const tags = [...newMemo.matchAll(/(?:^|\s)#([^\s#][\u4e00-\u9fa5a-zA-Z0-9_\/]*)/g)]
      .map(m => m[1]).filter((t, i, s) => s.indexOf(t) === i && t.length > 0);
    const now  = new Date().toISOString();
    const id   = String(Date.now()); // 【修复点 2】: 强转为 String，避免本地数据与远端不一致
    const obj  = normalizeMemo({
      id, content: newMemo, tags,
      createdAt: now, updatedAt: now, timestamp: now, lastModified: now,
      backlinks: pendingNewBacklinks || [], audioClips: pendingNewAudioClips || [],
      is_public: false, is_pinned: false,
    });
    
    const linkedIds = [...(pendingNewBacklinks || [])].map(String);
    
    setMemos(prev => {
      const withLinks = prev.map(m =>
        linkedIds.includes(String(m.id))
          ? { ...m, backlinks: [...new Set([...(m.backlinks || []), id])], updatedAt: now }
          : m
      );
      return [obj, ...withLinks];
    });
    
    setNewMemo('');
    setPendingNewBacklinks([]);
    setPendingNewAudioClips([]);

    // 【修复点 3】: 将同步操作转为 async 异步，彻底避免老数据覆盖新数据的竞态问题
    (async () => {
      try {
        await D1ApiClient.upsertMemo(obj);
        if (linkedIds.length > 0) {
          await Promise.all(linkedIds.map(lid => {
             const m = memosRef.current.find(x => String(x.id) === String(lid));
             return m ? D1ApiClient.upsertMemo(m) : Promise.resolve();
          }));
        }
        // 确保写完后再拉取
        _scheduleCloudSync?.('memo-add');
      } catch (err) {
        console.error("同步到D1失败:", err);
      }
    })();
  }, [newMemo, pendingNewBacklinks, pendingNewAudioClips, setMemos, _scheduleCloudSync]);

  // ─ 菜单操作 ──────────────────────────────────────────────────────────────────
  const handleMenuAction = useCallback((e, memoId, action) => {
    e.stopPropagation();
    const now = new Date().toISOString();
    const targetId = String(memoId);

    if (action === 'toggle-public') {
      setMemos(prev => {
        const next = prev.map(m => String(m.id) === targetId ? { ...m, is_public: !m.is_public, updatedAt: now } : m);
        const target = next.find(m => String(m.id) === targetId);
        toast.success(target?.is_public ? '已设为公开' : '已设为私有');
        if (target) {
          D1ApiClient.updateMemoMeta(targetId, { is_public: target.is_public })
            .catch(() => uploadMemo(target));
          _scheduleCloudSync?.('public-toggle');
        }
        return next;
      });

    } else if (action === 'pin') {
      setMemos(prev => {
        const target = prev.find(m => String(m.id) === targetId);
        if (!target || target.is_pinned) return prev;
        const next = prev.map(m => String(m.id) === targetId ? { ...m, is_pinned: true, pinnedAt: now, updatedAt: now } : m);
        const pinnedIds = next.filter(m => m.is_pinned).map(m => String(m.id));
        D1ApiClient.updateMemoMeta(targetId, { is_pinned: true, pinned_at: now }).catch(() => uploadMemo(next.find(m => String(m.id) === targetId)));
        D1ApiClient.updatePinnedIds(pinnedIds).catch(console.error);
        _scheduleCloudSync?.('memo-pin');
        return next;
      });

    } else if (action === 'unpin') {
      setMemos(prev => {
        const next = prev.map(m => String(m.id) === targetId ? { ...m, is_pinned: false, pinnedAt: null, updatedAt: now } : m);
        const pinnedIds = next.filter(m => m.is_pinned).map(m => String(m.id));
        D1ApiClient.updateMemoMeta(targetId, { is_pinned: false, pinned_at: null }).catch(() => uploadMemo(next.find(m => String(m.id) === targetId)));
        D1ApiClient.updatePinnedIds(pinnedIds).catch(console.error);
        _scheduleCloudSync?.('memo-unpin');
        return next;
      });

    } else if (action === 'edit') {
      const m = memos.find(m => String(m.id) === targetId);
      if (m) { setEditingId(targetId); setEditContent(m.content); }

    } else if (action === 'share') {
      const m = memos.find(m => String(m.id) === targetId);
      if (m) { setSelectedMemo(m); setIsShareDialogOpen(true); }

    } else if (action === 'delete') {
      setMemos(prev => {
        const next = prev
          .filter(m => String(m.id) !== targetId)
          .map(m => ({ ...m, backlinks: (m.backlinks || []).filter(id => String(id) !== targetId) }));
        addDeletedMemoTombstone(targetId);
        D1ApiClient.deleteMemo(targetId).catch(console.error);
        _scheduleCloudSync?.('memo-delete');
        return next;
      });
    }
    setActiveMenuId(null);
  }, [memos, setMemos, uploadMemo, _scheduleCloudSync]);

  // ─ 保存编辑 ──────────────────────────────────────────────────────────────────
  const saveEdit = useCallback((memoId) => {
    const targetId = String(memoId);
    const tags = [...editContent.matchAll(/(?:^|\s)#([^\s#][\u4e00-\u9fa5a-zA-Z0-9_\/]*)/g)]
      .map(m => m[1]).filter((t, i, s) => s.indexOf(t) === i && t.length > 0);
    const now = new Date().toISOString();
    setMemos(prev => {
      const next = prev.map(m => String(m.id) === targetId ? { ...m, content: editContent, tags, updatedAt: now, lastModified: now } : m);
      const edited = next.find(m => String(m.id) === targetId);
      if (edited) {
        uploadMemo(edited);
        next.filter(m => String(m.id) !== targetId && m.backlinks?.includes(targetId)).forEach(uploadMemo);
      }
      _scheduleCloudSync?.('memo-edit');
      return next;
    });
    setEditingId(null); setEditContent('');
  }, [editContent, setMemos, uploadMemo, _scheduleCloudSync]);

  const cancelEdit = () => { setEditingId(null); setEditContent(''); };

  // ─ 双链 ───────────────────────────────────────────────────────────────────────
  const handleAddBacklink = useCallback((fromId, toId) => {
    if (!toId) return;
    const fromStr = fromId ? String(fromId) : null;
    const toStr = String(toId);
    if (!fromStr) { setPendingNewBacklinks(p => p.includes(toStr) ? p : [...p, toStr]); return; }
    if (fromStr === toStr) return;
    const now = new Date().toISOString();
    setMemos(prev => {
      const next = prev.map(m => {
        if (String(m.id) === fromStr) return { ...m, backlinks: [...new Set([...(m.backlinks||[]), toStr])],   updatedAt: now };
        if (String(m.id) === toStr)   return { ...m, backlinks: [...new Set([...(m.backlinks||[]), fromStr])], updatedAt: now };
        return m;
      });
      uploadMemos(next.filter(m => String(m.id) === fromStr || String(m.id) === toStr));
      _scheduleCloudSync?.('memo-backlink');
      return next;
    });
  }, [setMemos, uploadMemos, _scheduleCloudSync]);

  const handleRemoveBacklink = useCallback((fromId, toId) => {
    if (!toId) return;
    const fromStr = fromId ? String(fromId) : null;
    const toStr = String(toId);
    if (!fromStr) { setPendingNewBacklinks(p => p.filter(id => String(id) !== toStr)); return; }
    if (fromStr === toStr) return;
    const now = new Date().toISOString();
    setMemos(prev => {
      const next = prev.map(m => {
        if (String(m.id) === fromStr) return { ...m, backlinks: (m.backlinks||[]).filter(id => String(id) !== toStr),   updatedAt: now };
        if (String(m.id) === toStr)   return { ...m, backlinks: (m.backlinks||[]).filter(id => String(id) !== fromStr), updatedAt: now };
        return m;
      });
      _scheduleCloudSync?.('memo-backlink-remove');
      return next;
    });
  }, [setMemos, _scheduleCloudSync]);

  // ─ 录音 ───────────────────────────────────────────────────────────────────────
  const handleAddAudioClip = useCallback((fromId, clip) => {
    if (!clip) return;
    const fromStr = fromId ? String(fromId) : null;
    if (!fromStr) { setPendingNewAudioClips(p => [...p, clip]); return; }
    const now = new Date().toISOString();
    setMemos(prev => {
      const next = prev.map(m => String(m.id) !== fromStr ? m : { ...m, audioClips: [...(m.audioClips||[]), clip], updatedAt: now });
      uploadMemo(next.find(m => String(m.id) === fromStr));
      _scheduleCloudSync?.('memo-audio-add');
      return next;
    });
  }, [setMemos, uploadMemo, _scheduleCloudSync]);

  const handleRemoveAudioClip = useCallback((fromId, idx) => {
    if (typeof idx !== 'number') return;
    const fromStr = fromId ? String(fromId) : null;
    if (!fromStr) { setPendingNewAudioClips(p => p.filter((_, i) => i !== idx)); return; }
    const now = new Date().toISOString();
    setMemos(prev => {
      const next = prev.map(m => String(m.id) !== fromStr ? m : { ...m, audioClips: (m.audioClips||[]).filter((_, i) => i !== idx), updatedAt: now });
      uploadMemo(next.find(m => String(m.id) === fromStr));
      _scheduleCloudSync?.('memo-audio-remove');
      return next;
    });
  }, [setMemos, uploadMemo, _scheduleCloudSync]);

  // ─ 预览 / 菜单控制 ───────────────────────────────────────────────────────────
  const handlePreviewMemo = (id) => setPreviewMemoId(String(id));
  const handleMenuContainerEnter = (id) => {
    clearTimeout(hoverTimerRef.current);
    if (activeMenuId !== id) hoverTimerRef.current = setTimeout(() => setActiveMenuId(id), 300);
  };
  const handleMenuContainerLeave = () => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setActiveMenuId(null), 150);
  };
  const handleMenuButtonClick = (id) => { clearTimeout(hoverTimerRef.current); setActiveMenuId(activeMenuId === id ? null : id); };

  useEffect(() => {
    const h = (e) => { if (activeMenuId && menuRefs.current[activeMenuId] && !menuRefs.current[activeMenuId].contains(e.target)) setActiveMenuId(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [activeMenuId]);

  // ─ Ctrl+K ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // ─ 画布模式 ───────────────────────────────────────────────────────────────────
  const handleCanvasModeToggle = useCallback(() => {
    const next = !isCanvasMode;
    setIsCanvasMode(next);
    if (next) { setIsLeftSidebarPinned(false); setIsRightSidebarPinned(false); toast.success('已进入画布模式'); }
    else toast.success('已退出画布模式');
  }, [isCanvasMode]);

  const handleCanvasAddMemo = useCallback((memo) => {
    const obj = normalizeMemo({ ...memo, is_pinned: !memo.content?.trim() ? true : false });
    setMemos(prev => { uploadMemo(obj); _scheduleCloudSync?.('canvas-add'); return [obj, ...prev]; });
  }, [setMemos, uploadMemo, _scheduleCloudSync]);

  const handleCanvasUpdateMemo = useCallback((id, updates) => {
    const targetId = String(id);
    setMemos(prev => {
      const next = prev.map(m => String(m.id) === targetId ? { ...m, ...updates, updatedAt: new Date().toISOString() } : m);
      uploadMemo(next.find(m => String(m.id) === targetId));
      _scheduleCloudSync?.('canvas-update');
      return next;
    });
  }, [setMemos, uploadMemo, _scheduleCloudSync]);

  const handleCanvasDeleteMemo = useCallback((id) => {
    const targetId = String(id);
    setMemos(prev => { addDeletedMemoTombstone(targetId); D1ApiClient.deleteMemo(targetId).catch(console.error); _scheduleCloudSync?.('canvas-delete'); return prev.filter(m => String(m.id) !== targetId); });
  }, [setMemos, _scheduleCloudSync]);

  const handleCanvasTogglePin = useCallback((id) => {
    const now = new Date().toISOString();
    const targetId = String(id);
    setMemos(prev => {
      const target = prev.find(m => String(m.id) === targetId);
      if (!target) return prev;
      const isPin = !target.is_pinned;
      const next  = prev.map(m => String(m.id) === targetId ? { ...m, is_pinned: isPin, pinnedAt: isPin ? now : null, updatedAt: now } : m);
      const pinnedIds = next.filter(m => m.is_pinned).map(m => String(m.id));
      D1ApiClient.updateMemoMeta(targetId, { is_pinned: isPin, pinned_at: isPin ? now : null }).catch(() => uploadMemo(next.find(m => String(m.id) === targetId)));
      D1ApiClient.updatePinnedIds(pinnedIds).catch(console.error);
      _scheduleCloudSync?.(isPin ? 'canvas-pin' : 'canvas-unpin');
      return next;
    });
  }, [setMemos, uploadMemo, _scheduleCloudSync]);

  // ─ 自定义快捷键 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const parse = (s) => {
      const parts = s.split('+');
      const key   = { Space: ' ', Tab: 'Tab', Enter: 'Enter', Escape: 'Escape' }[parts.at(-1)] || parts.at(-1);
      return { key, ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') };
    };
    const match = (sc, e) => {
      const p = parse(sc);
      return e.key === p.key && (e.ctrlKey || e.metaKey) === p.ctrlKey && e.altKey === p.altKey && e.shiftKey === p.shiftKey;
    };
    const h = (e) => {
      if (['INPUT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest?.('.shortcut-recording')) return;
      if (match(keyboardShortcuts.toggleSidebar,   e)) { e.preventDefault(); if (isCanvasMode) { toast.info('画布模式下不可固定侧栏'); return; } setIsLeftSidebarPinned(p => !p); setIsRightSidebarPinned(p => !p); }
      if (match(keyboardShortcuts.openAIDialog,    e)) { e.preventDefault(); setIsAIDialogOpen(p => !p); }
      if (match(keyboardShortcuts.openSettings,    e)) { e.preventDefault(); setIsSettingsOpen(true); }
      if (match(keyboardShortcuts.toggleCanvasMode,e)) { e.preventDefault(); handleCanvasModeToggle(); }
      if (match(keyboardShortcuts.openDailyReview, e)) { e.preventDefault(); setIsDailyReviewOpen(true); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [keyboardShortcuts, isCanvasMode, handleCanvasModeToggle]);

  // ─ 日期筛选 ───────────────────────────────────────────────────────────────────
  const handleDateClick = (ds) => { setActiveDate(ds === activeDate ? null : ds); setActiveTag(null); };

  const clearFilters = () => {
    setActiveTag(null);
    setActiveDate(null);
    setSearchQuery('');
  };

  // ─ AI ─────────────────────────────────────────────────────────────────────────
  const callAI = async ({ actionLabel, loadingId, systemPrompt, userPrompt, onSuccess }) => {
    if (!newMemo.trim()) { toast.error('请先输入一些内容'); return; }
    if (!aiConfig.enabled || !aiConfig.baseUrl || !aiConfig.apiKey) { toast.error('请先在设置中启用AI功能并配置API'); return; }
    try {
      toast.loading(`AI正在${actionLabel}中...`, { id: loadingId });
      const base = aiConfig.baseUrl.endsWith('/') ? aiConfig.baseUrl : aiConfig.baseUrl + '/';
      const res  = await fetch(`${base}chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.apiKey}` },
        body: JSON.stringify({ model: aiConfig.model || 'gpt-3.5-turbo', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 800, temperature: 0.8 }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || `AI请求失败 (${res.status})`); }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) { onSuccess(text); toast.success(`AI${actionLabel}完成`, { id: loadingId }); }
      else toast.error('AI返回内容为空', { id: loadingId });
    } catch (err) { console.error(err); toast.error(`AI${actionLabel}失败，请检查API配置`, { id: loadingId }); }
  };

  const handleAIContinue = () => callAI({
    actionLabel: '续写', loadingId: 'ai-continue',
    systemPrompt: '你是专业写作助手，请续写用户的内容，保持风格一致，不重复原文。',
    userPrompt: `请续写以下内容：${newMemo}`,
    onSuccess: (text) => setNewMemo(p => p + (p.endsWith('。')||p.endsWith('！')||p.endsWith('？') ? ' ' : '') + text),
  });
  const handleAIOptimize = () => callAI({
    actionLabel: '优化', loadingId: 'ai-optimize',
    systemPrompt: '你是专业文本优化助手，请优化内容，保持原意不变但提升表达质量。',
    userPrompt: `请优化以下内容：${newMemo}`,
    onSuccess: (text) => setNewMemo(text),
  });
  const handleAIChat = () => setIsAIDialogOpen(true);

  // ─ 随机背景 ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!backgroundConfig?.useRandom || backgroundConfig?.imageUrl) { setCurrentRandomBgUrl(''); return; }
    if (currentRandomBgUrl) return;
    let aborted = false;
    (async () => {
      try {
        const res  = await fetch('/api/proxy-fetch?url=' + encodeURIComponent('https://imgapi.xl0408.top/index.php'));
        if (res.ok) { const d = await res.json().catch(() => null); if (!aborted && d?.dataUrl) { setCurrentRandomBgUrl(d.dataUrl); return; } }
        if (!aborted) setCurrentRandomBgUrl('https://imgapi.xl0408.top/index.php');
      } catch {}
    })();
    return () => { aborted = true; };
  }, [backgroundConfig?.useRandom, backgroundConfig?.imageUrl, currentRandomBgUrl]);

  const effectiveBgUrl  = backgroundConfig.imageUrl || (backgroundConfig.useRandom ? currentRandomBgUrl : '');
  const backgroundStyle = effectiveBgUrl ? { backgroundImage: `url(${effectiveBgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: `brightness(${backgroundConfig.brightness}%)` } : {};
  const overlayStyle    = effectiveBgUrl ? { backdropFilter: `blur(${backgroundConfig.blur}px)`, backgroundColor: 'rgba(255,255,255,0.1)' } : {};
  const handleFavoriteRandomBackground = () => {
    if (!backgroundConfig.useRandom || backgroundConfig.imageUrl || !currentRandomBgUrl) return;
    updateBackgroundConfig({ imageUrl: currentRandomBgUrl, useRandom: false });
    toast.success('已收藏并设置为背景');
  };

  const filteredPinnedMemos = getPinned(filteredMemos);
  const allPinnedMemos = getPinned(memos);
  const allNormalMemos = getNormal(memos);

  // ─ Render ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col lg:flex-row lg:overflow-hidden lg:h-screen relative">
      {effectiveBgUrl && <div className="absolute inset-0 z-0" style={backgroundStyle} />}
      {effectiveBgUrl && <div className="absolute inset-0 z-0" style={overlayStyle} />}

      <div className="relative z-10 min-h-screen lg:h-full w-full flex flex-col lg:flex-row">

        <LeftSidebar
          heatmapData={heatmapData}
          memos={isAuthenticated ? allNormalMemos : allNormalMemos.filter(m => m.is_public)}
          pinnedMemos={isAuthenticated ? allPinnedMemos : allPinnedMemos.filter(m => m.is_public)}
          isLeftSidebarHidden={isLeftSidebarHidden}   setIsLeftSidebarHidden={setIsLeftSidebarHidden}
          isLeftSidebarPinned={isLeftSidebarPinned}   setIsLeftSidebarPinned={setIsLeftSidebarPinned}
          isLeftSidebarHovered={isLeftSidebarHovered}
          isAppLoaded={isAppLoaded} isInitialLoad={isInitialLoad}
          isCanvasMode={isCanvasMode} setIsCanvasMode={setIsCanvasMode}
          onSettingsOpen={() => setIsSettingsOpen(true)}
          onDateClick={handleDateClick}
          onOpenDailyReview={() => setIsDailyReviewOpen(true)}
          showFavoriteRandomButton={backgroundConfig.useRandom && !backgroundConfig.imageUrl}
          onFavoriteRandomBackground={handleFavoriteRandomBackground}
          isAuthenticated={isAuthenticated}
        />

        {isCanvasMode ? (
          <CanvasMode
            memos={allNormalMemos} pinnedMemos={allPinnedMemos}
            onAddMemo={handleCanvasAddMemo}
            onUpdateMemo={handleCanvasUpdateMemo}
            onDeleteMemo={handleCanvasDeleteMemo}
            onTogglePin={handleCanvasTogglePin}
            onToolPanelVisibleChange={setCanvasToolPanelVisible}
          />
        ) : (
          <MainContent
            isLeftSidebarHidden={isLeftSidebarHidden}   isRightSidebarHidden={isRightSidebarHidden}
            setIsLeftSidebarHidden={setIsLeftSidebarHidden} setIsRightSidebarHidden={setIsRightSidebarHidden}
            isLeftSidebarPinned={isLeftSidebarPinned}   isRightSidebarPinned={isRightSidebarPinned}
            searchQuery={searchQuery}   setSearchQuery={setSearchQuery}
            newMemo={newMemo}           setNewMemo={setNewMemo}
            filteredMemos={filteredMemos}
            pinnedMemos={filteredPinnedMemos}
            activeMenuId={activeMenuId}
            editingId={editingId}       editContent={editContent}
            activeTag={activeTag}       activeDate={activeDate}
            showScrollToTop={showScrollToTop}
            searchInputRef={searchInputRef}
            memosContainerRef={memosContainerRef}
            menuRefs={menuRefs}
            onMobileMenuOpen={() => setIsMobileSidebarOpen(true)}
            onAddMemo={addMemo}
            onMenuAction={handleMenuAction}
            onMenuContainerEnter={handleMenuContainerEnter}
            onMenuContainerLeave={handleMenuContainerLeave}
            onMenuButtonClick={handleMenuButtonClick}
            onEditContentChange={setEditContent}
            onSaveEdit={saveEdit}       onCancelEdit={cancelEdit}
            onTagClick={setActiveTag}   onScrollToTop={scrollToTop}
            clearFilters={clearFilters}
            onEditorFocus={() => setIsEditorFocused(true)}
            onEditorBlur={() => setIsEditorFocused(false)}
            allMemos={memos}
            onAddBacklink={handleAddBacklink}
            onPreviewMemo={handlePreviewMemo}
            pendingNewBacklinks={pendingNewBacklinks}
            onRemoveBacklink={handleRemoveBacklink}
            pendingNewAudioClips={pendingNewAudioClips}
            onRemoveAudioClip={handleRemoveAudioClip}
            onAddAudioClip={handleAddAudioClip}
            onOpenMusic={() => { if (musicConfig?.enabled) setMusicModal(m => ({ ...m, isOpen: true })); }}
            musicEnabled={!!musicConfig?.enabled}
            onOpenMusicSearch={(q) => { setMusicSearchKeyword(q); setMusicSearchOpen(true); }}
            isAuthenticated={isAuthenticated}
          />
        )}

        <RightSidebar
          memos={memos}
          activeTag={activeTag}
          setActiveTag={(tag) => { setActiveTag(tag); setActiveDate(null); }}
          isRightSidebarHidden={isRightSidebarHidden} setIsRightSidebarHidden={setIsRightSidebarHidden}
          isRightSidebarPinned={isRightSidebarPinned} setIsRightSidebarPinned={setIsRightSidebarPinned}
          isRightSidebarHovered={isRightSidebarHovered}
          isAppLoaded={isAppLoaded} isInitialLoad={isInitialLoad}
          isCanvasMode={isCanvasMode}
        />
      </div>

      <MobileSidebar
        isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}
        heatmapData={heatmapData}
        memos={isAuthenticated ? memos : memos.filter(m => m.is_public)}
        activeTag={activeTag}
        setActiveTag={(tag) => { setActiveTag(tag); setActiveDate(null); }}
        onSettingsOpen={() => setIsSettingsOpen(true)}
        onDateClick={handleDateClick}
        isAuthenticated={isAuthenticated}
        onOpenMusic={() => { if (musicConfig?.enabled) setMusicModal(m => ({ ...m, isOpen: true })); }}
      />

      <SettingsCard isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onOpenTutorial={() => setIsTutorialOpen(true)} />
      <ShareDialog   isOpen={isShareDialogOpen} onClose={() => setIsShareDialogOpen(false)} memo={selectedMemo} />
      <AIDialog      isOpen={isAIDialogOpen}    onClose={() => setIsAIDialogOpen(false)}    memos={memos} />
      <DailyReview   isOpen={isDailyReviewOpen} onClose={() => setIsDailyReviewOpen(false)} memos={memos} />
      <TutorialDialog isOpen={isTutorialOpen}   onClose={() => setIsTutorialOpen(false)} />
      <MemoPreviewDialog
        memo={memos.find(m => String(m.id) === previewMemoId) || null}
        open={!!previewMemoId}
        onClose={() => setPreviewMemoId(null)}
      />

      {musicConfig?.enabled && (
        <>
          <MusicModal isOpen={musicModal.isOpen} onClose={() => setMusicModal(m => ({ ...m, isOpen: false }))} danmakuText={musicModal.danmakuText} enableDanmaku={musicModal.enableDanmaku} />
          {!isCanvasMode && <MiniMusicPlayer onOpenFull={() => setMusicModal(m => ({ ...m, isOpen: true }))} />}
          <MusicSearchCard open={musicSearchOpen} keyword={musicSearchKeyword} onClose={() => setMusicSearchOpen(false)} />
        </>
      )}

      {!isCanvasMode && isAuthenticated && (
        <AIButton
          isSettingsOpen={isSettingsOpen} isShareDialogOpen={isShareDialogOpen} isEditorFocused={isEditorFocused}
          onContinue={handleAIContinue} onOptimize={handleAIOptimize} onChat={handleAIChat}
        />
      )}
    </div>
  );
};

export default Index;
