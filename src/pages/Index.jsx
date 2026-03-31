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
import { usePasswordAuth } from '@/context/PasswordAuthContext';
import { addDeletedMemoTombstone } from '@/lib/utils';
import { D1ApiClient } from '@/lib/d1-api';
import { toast } from 'sonner';

const Index = () => {
  // ── State ──────────────────────────────────────────────
  const [memos, setMemos] = useState([]);
  const [newMemo, setNewMemo] = useState('');
  const [filteredMemos, setFilteredMemos] = useState([]);
  const [activeTag, setActiveTag] = useState(null);
  const [activeDate, setActiveDate] = useState(null);
  const [heatmapData, setHeatmapData] = useState([]);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [pinnedMemos, setPinnedMemos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLeftSidebarHidden, setIsLeftSidebarHidden] = useState(false);
  const [isRightSidebarHidden, setIsRightSidebarHidden] = useState(false);
  const [isLeftSidebarPinned, setIsLeftSidebarPinned] = useState(true);
  const [isRightSidebarPinned, setIsRightSidebarPinned] = useState(true);
  const [isLeftSidebarHovered, setIsLeftSidebarHovered] = useState(false);
  const [isRightSidebarHovered, setIsRightSidebarHovered] = useState(false);
  const [isAppLoaded, setIsAppLoaded] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [isAIDialogOpen, setIsAIDialogOpen] = useState(false);
  const [isCanvasMode, setIsCanvasMode] = useState(false);
  const [canvasToolPanelVisible, setCanvasToolPanelVisible] = useState(false);
  const [isDailyReviewOpen, setIsDailyReviewOpen] = useState(false);
  const [previewMemoId, setPreviewMemoId] = useState(null);
  const [pendingNewBacklinks, setPendingNewBacklinks] = useState([]);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [pendingNewAudioClips, setPendingNewAudioClips] = useState([]);
  const [musicSearchOpen, setMusicSearchOpen] = useState(false);
  const [musicSearchKeyword, setMusicSearchKeyword] = useState('');
  const [musicModal, setMusicModal] = useState({
    isOpen: false,
    title: '鲜花',
    musicUrl: 'https://pic.lover.nyc.mn/2025-08/回春丹 - 鲜花_1755699293512.flac',
    cover: '/images/xh.jpg',
    author: '回春丹',
    danmakuText: '好听',
    enableDanmaku: true,
  });

  // ── Refs ───────────────────────────────────────────────
  const hoverTimerRef = useRef(null);
  const menuRefs = useRef({});
  const searchInputRef = useRef(null);
  const memosContainerRef = useRef(null);
  // 用于 beforeunload 中拿到最新的 memos/pinnedMemos
  const memosRef = useRef(memos);
  const pinnedMemosRef = useRef(pinnedMemos);
  useEffect(() => { memosRef.current = memos; }, [memos]);
  useEffect(() => { pinnedMemosRef.current = pinnedMemos; }, [pinnedMemos]);

  // ── Context ────────────────────────────────────────────
  const { backgroundConfig, updateBackgroundConfig, aiConfig, keyboardShortcuts, musicConfig, _scheduleCloudSync } = useSettings();
  const { isAuthenticated } = usePasswordAuth();
  const [currentRandomBgUrl, setCurrentRandomBgUrl] = useState('');

  // ── 工具函数：触发 app:dataChanged 事件 ───────────────
  const dispatchDataChanged = (part, extra = {}) => {
    try {
      window.dispatchEvent(new CustomEvent('app:dataChanged', { detail: { part, ...extra } }));
    } catch { }
  };

  // ── 工具函数：通用 localStorage 持久化 ───────────────
  const persistLocally = (nextMemos, nextPinned) => {
    localStorage.setItem('memos', JSON.stringify(nextMemos));
    localStorage.setItem('pinnedMemos', JSON.stringify(nextPinned));
  };

  // ── 初始化音乐URL ─────────────────────────────────────
  useEffect(() => {
    if (!musicModal.musicUrl) {
      setMusicModal(m => ({ ...m, musicUrl: 'https://file-examples.com/storage/fe9b7a6c9f3a8b2e9b0b8d3/2017/11/file_example_MP3_700KB.mp3' }));
    }
  }, []);

  // ── 页面卸载时：用 sendBeacon 抢救未同步的变更 ────────
  useEffect(() => {
    if (!isAuthenticated) return;
    const handleUnload = () => {
      try {
        const all = [...memosRef.current, ...pinnedMemosRef.current];
        for (const m of all) {
          D1ApiClient.beaconUpsertMemo(m);
        }
      } catch { }
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [isAuthenticated]);

  // ── 移动端侧栏滚动锁 ──────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = isMobileSidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobileSidebarOpen]);

  // ── 左侧栏鼠标 hover ──────────────────────────────────
  useEffect(() => {
    let hoverTimer;
    const handleMouseMove = (e) => {
      if (e.target?.closest?.('.sidebar-hover-block')) return;
      if (canvasToolPanelVisible || isAIDialogOpen || isDailyReviewOpen
          || document.body.getAttribute('data-music-modal-open') === 'true') return;
      if (!isLeftSidebarPinned) {
        if (e.clientX < 50) {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => setIsLeftSidebarHovered(true), 150);
        } else if (e.clientX > 350 && isLeftSidebarHovered) {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => setIsLeftSidebarHovered(false), 200);
        }
      }
    };
    if (!isLeftSidebarPinned && !isAIDialogOpen && !isDailyReviewOpen) {
      document.addEventListener('mousemove', handleMouseMove);
    }
    return () => { document.removeEventListener('mousemove', handleMouseMove); clearTimeout(hoverTimer); };
  }, [isLeftSidebarPinned, isLeftSidebarHovered, canvasToolPanelVisible, isAIDialogOpen, isDailyReviewOpen]);

  // ── 右侧栏鼠标 hover ──────────────────────────────────
  useEffect(() => {
    let hoverTimer;
    const handleMouseMove = (e) => {
      if (e.target?.closest?.('.sidebar-hover-block')) return;
      if (isAIDialogOpen || isDailyReviewOpen
          || document.body.getAttribute('data-music-modal-open') === 'true') return;
      if (!isRightSidebarPinned) {
        if (e.clientX > window.innerWidth - 50) {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => setIsRightSidebarHovered(true), 150);
        } else if (e.clientX < window.innerWidth - 350 && isRightSidebarHovered) {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => setIsRightSidebarHovered(false), 200);
        }
      }
    };
    if (!isRightSidebarPinned && !isAIDialogOpen && !isDailyReviewOpen) {
      document.addEventListener('mousemove', handleMouseMove);
    }
    return () => { document.removeEventListener('mousemove', handleMouseMove); clearTimeout(hoverTimer); };
  }, [isRightSidebarPinned, isRightSidebarHovered, isAIDialogOpen, isDailyReviewOpen]);

  // ── 弹窗开启时收起悬浮侧栏 ───────────────────────────
  useEffect(() => {
    if (isAIDialogOpen || isDailyReviewOpen) {
      if (!isLeftSidebarPinned && isLeftSidebarHovered) setIsLeftSidebarHovered(false);
      if (!isRightSidebarPinned && isRightSidebarHovered) setIsRightSidebarHovered(false);
    }
  }, [isAIDialogOpen, isDailyReviewOpen, isLeftSidebarPinned, isRightSidebarPinned, isLeftSidebarHovered, isRightSidebarHovered]);

  // ── 滚动监听 ──────────────────────────────────────────
  useEffect(() => {
    const container = memosContainerRef.current;
    if (!container) return;
    const handleScroll = () => setShowScrollToTop(container.scrollTop > 200);
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    memosContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── 从 localStorage 初始化数据 ───────────────────────
  useEffect(() => {
    const savedMemos = localStorage.getItem('memos');
    const savedPinned = localStorage.getItem('pinnedMemos');
    const savedLeftPinned = localStorage.getItem('isLeftSidebarPinned');
    const savedRightPinned = localStorage.getItem('isRightSidebarPinned');
    const savedCanvasMode = localStorage.getItem('isCanvasMode');
    const savedCanvasState = localStorage.getItem('canvasState');

    let memoPositions = {};
    try {
      if (savedCanvasState) {
        const st = JSON.parse(savedCanvasState);
        if (st?.memoPositions) memoPositions = st.memoPositions;
      }
    } catch { }

    const normalizeMemo = (memo) => ({
      id: memo.id || Date.now() + Math.random(),
      content: memo.content || '',
      tags: memo.tags || [],
      timestamp:    memo.timestamp    || memo.createdAt  || new Date().toISOString(),
      lastModified: memo.lastModified || memo.updatedAt  || new Date().toISOString(),
      createdAt:    memo.createdAt    || memo.timestamp  || new Date().toISOString(),
      updatedAt:    memo.updatedAt    || memo.lastModified || new Date().toISOString(),
      backlinks:  Array.isArray(memo.backlinks)  ? memo.backlinks  : [],
      audioClips: Array.isArray(memo.audioClips) ? memo.audioClips : [],
      is_public:  typeof memo.is_public === 'boolean' ? memo.is_public : false,
      is_pinned:  typeof memo.is_pinned === 'boolean' ? memo.is_pinned : false,
      pinnedAt:   memo.pinnedAt || null,
      canvasX: typeof memo.canvasX === 'number' ? memo.canvasX : memoPositions[memo.id]?.x,
      canvasY: typeof memo.canvasY === 'number' ? memo.canvasY : memoPositions[memo.id]?.y,
    });

    if (savedMemos) {
      try { setMemos(JSON.parse(savedMemos).map(normalizeMemo)); } catch (e) { console.error(e); }
    }
    if (savedPinned) {
      try { setPinnedMemos(JSON.parse(savedPinned).map(normalizeMemo)); } catch (e) { console.error(e); }
    }

    const isCanvas = savedCanvasMode ? JSON.parse(savedCanvasMode) : false;
    if (isCanvas) {
      setIsCanvasMode(true);
      setIsLeftSidebarPinned(false);
      setIsRightSidebarPinned(false);
    } else {
      if (savedLeftPinned  !== null) try { setIsLeftSidebarPinned (JSON.parse(savedLeftPinned));  } catch { }
      if (savedRightPinned !== null) try { setIsRightSidebarPinned(JSON.parse(savedRightPinned)); } catch { }
    }

    setTimeout(() => { setIsAppLoaded(true); setIsInitialLoad(false); }, 100);
  }, []);

  // ── 监听全局数据变更 (sync/restore 事件) ────────────
  useEffect(() => {
    const loadFromLocal = () => {
      try {
        const savedMemos = localStorage.getItem('memos');
        const savedPinned = localStorage.getItem('pinnedMemos');
        const savedCanvasState = localStorage.getItem('canvasState');
        let memoPositions = {};
        try {
          if (savedCanvasState) {
            const st = JSON.parse(savedCanvasState);
            if (st?.memoPositions) memoPositions = st.memoPositions;
          }
        } catch { }

        const normalizeMemo = (memo) => ({
          id: memo.id || Date.now() + Math.random(),
          content: memo.content || '',
          tags: memo.tags || [],
          timestamp:    memo.timestamp    || memo.createdAt  || new Date().toISOString(),
          lastModified: memo.lastModified || memo.updatedAt  || new Date().toISOString(),
          createdAt:    memo.createdAt    || memo.timestamp  || new Date().toISOString(),
          updatedAt:    memo.updatedAt    || memo.lastModified || new Date().toISOString(),
          backlinks:  Array.isArray(memo.backlinks)  ? memo.backlinks  : [],
          audioClips: Array.isArray(memo.audioClips) ? memo.audioClips : [],
          is_public:  typeof memo.is_public === 'boolean' ? memo.is_public : false,
          is_pinned:  typeof memo.is_pinned === 'boolean' ? memo.is_pinned : false,
          pinnedAt:   memo.pinnedAt || null,
          canvasX: typeof memo.canvasX === 'number' ? memo.canvasX : memoPositions[memo.id]?.x,
          canvasY: typeof memo.canvasY === 'number' ? memo.canvasY : memoPositions[memo.id]?.y,
        });

        if (savedMemos) {
          const normalized = JSON.parse(savedMemos).map(normalizeMemo);
          if (JSON.stringify(normalized) !== JSON.stringify(memos)) setMemos(normalized);
        }
        if (savedPinned) {
          const normalized = JSON.parse(savedPinned).map(normalizeMemo);
          if (JSON.stringify(normalized) !== JSON.stringify(pinnedMemos)) setPinnedMemos(normalized);
        }
      } catch { }
    };

    const onDataChanged = (e) => {
      const part = e?.detail?.part || '';
      if (part.includes('sync.') || part.includes('restore.') || part === 'startup') loadFromLocal();
    };
    const onStorage = (e) => {
      if (e?.key === 'memos' || e?.key === 'pinnedMemos' || e?.key === 'canvasState') loadFromLocal();
    };
    window.addEventListener('app:dataChanged', onDataChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('app:dataChanged', onDataChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [memos, pinnedMemos]);

  // ── 同步 memo 画布位置到 canvasState ─────────────────
  useEffect(() => {
    try {
      const positions = {};
      [...memos, ...pinnedMemos].forEach(m => {
        if (typeof m.canvasX === 'number' && typeof m.canvasY === 'number')
          positions[m.id] = { x: m.canvasX, y: m.canvasY };
      });
      const prev = (() => { try { return JSON.parse(localStorage.getItem('canvasState') || '{}'); } catch { return {}; } })();
      localStorage.setItem('canvasState', JSON.stringify({ ...prev, memoPositions: positions }));
      dispatchDataChanged('canvas.memoPositions');
    } catch { }
  }, [memos, pinnedMemos]);

  // ── 持久化到 localStorage ────────────────────────────
  useEffect(() => {
    if (isInitialLoad) return;
    persistLocally(memos, pinnedMemos);
  }, [memos, pinnedMemos, isInitialLoad]);

  // 侧栏 pinned 状态
  useEffect(() => { if (!isCanvasMode) localStorage.setItem('isLeftSidebarPinned',  JSON.stringify(isLeftSidebarPinned));  }, [isLeftSidebarPinned,  isCanvasMode]);
  useEffect(() => { if (!isCanvasMode) localStorage.setItem('isRightSidebarPinned', JSON.stringify(isRightSidebarPinned)); }, [isRightSidebarPinned, isCanvasMode]);

  // 画布模式
  useEffect(() => {
    localStorage.setItem('isCanvasMode', JSON.stringify(isCanvasMode));
    dispatchDataChanged('canvas.mode');
  }, [isCanvasMode]);

  // 启动完成后触发一次
  useEffect(() => {
    if (!isInitialLoad) dispatchDataChanged('startup');
  }, [isInitialLoad]);

  // 首次弹出教程
  useEffect(() => {
    try {
      if (!localStorage.getItem('hasSeenTutorialV1')) {
        const t = setTimeout(() => setIsTutorialOpen(true), 300);
        return () => clearTimeout(t);
      }
    } catch { }
  }, []);

  // ── 添加新 memo ───────────────────────────────────────
  const addMemo = async () => {
    if (!newMemo.trim()) return;

    const extractedTags = [...newMemo.matchAll(/(?:^|\s)#([^\s#][\u4e00-\u9fa5a-zA-Z0-9_\/]*)/g)]
      .map(m => m[1])
      .filter((tag, i, self) => self.indexOf(tag) === i && tag.length > 0);

    const newId = Date.now();
    const now = new Date().toISOString();
    const newMemoObj = {
      id: newId, content: newMemo, tags: extractedTags,
      createdAt: now, updatedAt: now, timestamp: now, lastModified: now,
      backlinks:  Array.isArray(pendingNewBacklinks)  ? pendingNewBacklinks  : [],
      audioClips: Array.isArray(pendingNewAudioClips) ? pendingNewAudioClips : [],
      is_public: false, is_pinned: false, pinnedAt: null,
    };

    // 双向更新被引用 memo 的 backlinks
    const linkedIds = pendingNewBacklinks || [];
    const addLink = (list) => list.map(m =>
      linkedIds.includes(m.id)
        ? { ...m, backlinks: Array.from(new Set([...(m.backlinks || []), newId])), updatedAt: now, lastModified: now }
        : m
    );
    const nextMemos  = [newMemoObj, ...addLink(memos)];
    const nextPinned = addLink(pinnedMemos);

    setMemos(nextMemos);
    setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    setNewMemo('');
    setPendingNewBacklinks([]);
    setPendingNewAudioClips([]);

    if (isAuthenticated) {
      // 立即原子上传新 memo
      D1ApiClient.upsertMemo(newMemoObj).catch(e => console.error('create memo upload failed:', e));
      // 同步被更新双链的 memo
      linkedIds.forEach(id => {
        const m = [...nextMemos, ...nextPinned].find(x => x.id === id);
        if (m) D1ApiClient.upsertMemo(m).catch(e => console.error('linked memo upload failed:', e));
      });
      _scheduleCloudSync?.('memo-add');
    }
    dispatchDataChanged('memo.add', { priority: 'high', id: newId });
  };

  // ── 热力图数据 ────────────────────────────────────────
  useEffect(() => {
    const memoCountByDate = {};
    let all = [...memos, ...pinnedMemos];
    if (!isAuthenticated) all = all.filter(m => m.is_public);
    all.forEach(m => {
      const date = (m.createdAt || m.timestamp || new Date().toISOString()).split('T')[0];
      memoCountByDate[date] = (memoCountByDate[date] || 0) + 1;
    });
    const today = new Date();
    const data = Array.from({ length: 365 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      return { date: ds, count: memoCountByDate[ds] || 0 };
    });
    setHeatmapData(data);
  }, [memos, pinnedMemos, isAuthenticated]);

  // ── 筛选 ──────────────────────────────────────────────
  useEffect(() => {
    let base = [...pinnedMemos, ...memos];
    const seen = new Set();
    base = base.filter(m => { const id = String(m.id); if (seen.has(id)) return false; seen.add(id); return true; });
    if (!isAuthenticated) base = base.filter(m => m.is_public);
    if (activeTag) base = base.filter(m => m.tags?.includes(activeTag) || m.tags?.some(t => t.startsWith(activeTag + '/')));
    if (activeDate) base = base.filter(m => {
      const src = m.createdAt || m.timestamp || '';
      return (typeof src === 'string' ? src : new Date(src).toISOString()).split('T')[0] === activeDate;
    });
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const hit = base.filter(m =>
        m.content?.toLowerCase().includes(q) || m.tags?.some(t => t.toLowerCase().includes(q))
      );
      setFilteredMemos(hit.length > 0 ? hit : base);
    } else {
      setFilteredMemos(base);
    }
  }, [memos, pinnedMemos, activeTag, activeDate, searchQuery, isAuthenticated]);

  // ── 菜单操作 ──────────────────────────────────────────
  const handleMenuAction = (e, memoId, action) => {
    e.stopPropagation();
    const now = new Date().toISOString();

    if (action === 'toggle-public') {
      // 1. 本地更新
      const toggle = (list) => list.map(m =>
        m.id === memoId ? { ...m, is_public: !m.is_public, updatedAt: now, lastModified: now } : m
      );
      const nextMemos  = toggle(memos);
      const nextPinned = toggle(pinnedMemos);
      setMemos(nextMemos);
      setPinnedMemos(nextPinned);
      persistLocally(nextMemos, nextPinned);

      const target = [...nextMemos, ...nextPinned].find(m => m.id === memoId);
      toast.success(target?.is_public ? '已设为公开' : '已设为私有');

      // 2. 立即 PATCH 元数据（轻量级，不传全量 content）
      if (isAuthenticated && target) {
        D1ApiClient.updateMemoMeta(memoId, { is_public: target.is_public })
          .catch(e => {
            console.error('updateMemoMeta(public) failed, fallback to full upsert:', e);
            D1ApiClient.upsertMemo(target).catch(console.error);
          });
        _scheduleCloudSync?.('public-toggle');
      }
      dispatchDataChanged('memo.update', { priority: 'high', id: memoId });

    } else if (action === 'pin') {
      const memoToPin = memos.find(m => m.id === memoId);
      if (memoToPin && !pinnedMemos.some(p => p.id === memoId)) {
        const pinned = { ...memoToPin, is_pinned: true, isPinned: true, pinnedAt: now, updatedAt: now, lastModified: now };
        const nextPinned = [pinned, ...pinnedMemos];
        const nextMemos  = memos.filter(m => m.id !== memoId);
        setPinnedMemos(nextPinned);
        setMemos(nextMemos);
        persistLocally(nextMemos, nextPinned);

        if (isAuthenticated) {
          // 轻量级：只更新 memos 表的 is_pinned 字段 + settings 的置顶 ID 列表
          const pinnedIds = nextPinned.map(m => m.id);
          D1ApiClient.updateMemoMeta(memoId, { is_pinned: true, pinned_at: now })
            .catch(e => console.error('updateMemoMeta(pin) failed:', e));
          D1ApiClient.updatePinnedIds(pinnedIds)
            .catch(e => console.error('updatePinnedIds failed:', e));
          _scheduleCloudSync?.('memo-pin');
        }
      }

    } else if (action === 'unpin') {
      const memoToUnpin = pinnedMemos.find(m => m.id === memoId);
      if (memoToUnpin) {
        const unpinned = { ...memoToUnpin, is_pinned: false, isPinned: false, pinnedAt: null, updatedAt: now, lastModified: now };
        delete unpinned.pinnedAt;
        const nextPinned = pinnedMemos.filter(m => m.id !== memoId);
        const nextMemos  = [unpinned, ...memos];
        setMemos(nextMemos);
        setPinnedMemos(nextPinned);
        persistLocally(nextMemos, nextPinned);

        if (isAuthenticated) {
          const pinnedIds = nextPinned.map(m => m.id);
          D1ApiClient.updateMemoMeta(memoId, { is_pinned: false, pinned_at: null })
            .catch(e => console.error('updateMemoMeta(unpin) failed:', e));
          D1ApiClient.updatePinnedIds(pinnedIds)
            .catch(e => console.error('updatePinnedIds failed:', e));
          // 同步 memo 本身的内容（含 is_pinned=false），避免全量同步时状态覆盖
          D1ApiClient.upsertMemo(unpinned)
            .catch(e => console.error('upsertMemo after unpin failed:', e));
          _scheduleCloudSync?.('memo-unpin');
        }
      }

    } else if (action === 'edit') {
      const m = [...memos, ...pinnedMemos].find(m => m.id === memoId);
      if (m) { setEditingId(memoId); setEditContent(m.content); }

    } else if (action === 'share') {
      const m = [...memos, ...pinnedMemos].find(m => m.id === memoId);
      if (m) { setSelectedMemo(m); setIsShareDialogOpen(true); }

    } else if (action === 'delete') {
      const filterOut = (list) => list
        .filter(m => m.id !== memoId)
        .map(m => ({ ...m, backlinks: (m.backlinks || []).filter(id => id !== memoId) }));
      const nextMemos  = filterOut(memos);
      const nextPinned = filterOut(pinnedMemos);
      setMemos(nextMemos);
      setPinnedMemos(nextPinned);
      persistLocally(nextMemos, nextPinned);
      addDeletedMemoTombstone(memoId);

      if (isAuthenticated) {
        D1ApiClient.deleteMemo(memoId).catch(e => console.error('delete memo failed:', e));
        _scheduleCloudSync?.('memo-delete');
      }
    }

    setActiveMenuId(null);
  };

  // ── 保存编辑 ──────────────────────────────────────────
  const saveEdit = (memoId) => {
    const tags = [...editContent.matchAll(/(?:^|\s)#([^\s#][\u4e00-\u9fa5a-zA-Z0-9_\/]*)/g)]
      .map(m => m[1])
      .filter((t, i, s) => s.indexOf(t) === i && t.length > 0);
    const now = new Date().toISOString();

    const update = (list) => list.map(m =>
      m.id === memoId ? { ...m, content: editContent, tags, updatedAt: now, lastModified: now } : m
    );
    const nextMemos  = update(memos);
    const nextPinned = update(pinnedMemos);
    setMemos(nextMemos);
    setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);

    if (isAuthenticated) {
      const edited = [...nextMemos, ...nextPinned].find(m => m.id === memoId);
      if (edited) D1ApiClient.upsertMemo(edited).catch(e => console.error('edit upload failed:', e));
      // 同步所有反向引用本条 memo 的 memo（backlinks 未变，但 updatedAt 可能影响合并）
      [...nextMemos, ...nextPinned].forEach(m => {
        if (m.id !== memoId && m.backlinks?.includes(memoId)) {
          D1ApiClient.upsertMemo(m).catch(e => console.error('backlink memo upload failed:', e));
        }
      });
      _scheduleCloudSync?.('memo-edit');
    }
    setEditingId(null);
    setEditContent('');
  };

  const cancelEdit = () => { setEditingId(null); setEditContent(''); };

  // ── 双链操作 ──────────────────────────────────────────
  const handleAddBacklink = (fromId, toId) => {
    if (!toId) return;
    if (!fromId) { setPendingNewBacklinks(prev => prev.includes(toId) ? prev : [...prev, toId]); return; }
    if (fromId === toId) return;
    const now = new Date().toISOString();
    const add = (list) => list.map(m => {
      if (m.id === fromId) return { ...m, backlinks: Array.from(new Set([...(m.backlinks || []), toId])), updatedAt: now };
      if (m.id === toId)   return { ...m, backlinks: Array.from(new Set([...(m.backlinks || []), fromId])), updatedAt: now };
      return m;
    });
    const nextMemos  = add(memos);
    const nextPinned = add(pinnedMemos);
    setMemos(nextMemos); setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    if (isAuthenticated) {
      [fromId, toId].forEach(id => {
        const m = [...nextMemos, ...nextPinned].find(x => x.id === id);
        if (m) D1ApiClient.upsertMemo(m).catch(console.error);
      });
      _scheduleCloudSync?.('memo-backlink');
    }
  };

  const handleRemoveBacklink = (fromId, toId) => {
    if (!toId) return;
    if (!fromId) { setPendingNewBacklinks(prev => prev.filter(id => id !== toId)); return; }
    if (fromId === toId) return;
    const now = new Date().toISOString();
    const prune = (list) => list.map(m => {
      if (m.id === fromId) return { ...m, backlinks: (m.backlinks || []).filter(id => id !== toId),   updatedAt: now };
      if (m.id === toId)   return { ...m, backlinks: (m.backlinks || []).filter(id => id !== fromId), updatedAt: now };
      return m;
    });
    const nextMemos  = prune(memos);
    const nextPinned = prune(pinnedMemos);
    setMemos(nextMemos); setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    if (isAuthenticated) _scheduleCloudSync?.('memo-backlink-remove');
  };

  // ── 录音操作 ──────────────────────────────────────────
  const handleRemoveAudioClip = (fromId, idx) => {
    if (typeof idx !== 'number') return;
    if (!fromId) { setPendingNewAudioClips(prev => prev.filter((_, i) => i !== idx)); return; }
    const now = new Date().toISOString();
    const rem = (list) => list.map(m =>
      m.id !== fromId ? m : { ...m, audioClips: (m.audioClips || []).filter((_, i) => i !== idx), updatedAt: now, lastModified: now }
    );
    const nextMemos  = rem(memos);
    const nextPinned = rem(pinnedMemos);
    setMemos(nextMemos); setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    if (isAuthenticated) {
      const m = [...nextMemos, ...nextPinned].find(x => x.id === fromId);
      if (m) D1ApiClient.upsertMemo(m).catch(console.error);
      _scheduleCloudSync?.('memo-audio-remove');
    }
  };

  const handleAddAudioClip = (fromId, clip) => {
    if (!clip) return;
    if (!fromId) { setPendingNewAudioClips(prev => [...prev, clip]); return; }
    const now = new Date().toISOString();
    const add = (list) => list.map(m =>
      m.id !== fromId ? m : { ...m, audioClips: [...(m.audioClips || []), clip], updatedAt: now, lastModified: now }
    );
    const nextMemos  = add(memos);
    const nextPinned = add(pinnedMemos);
    setMemos(nextMemos); setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    if (isAuthenticated) {
      const m = [...nextMemos, ...nextPinned].find(x => x.id === fromId);
      if (m) D1ApiClient.upsertMemo(m).catch(console.error);
      _scheduleCloudSync?.('memo-audio-add');
    }
  };

  // ── 预览 ─────────────────────────────────────────────
  const handlePreviewMemo = (memoId) => setPreviewMemoId(memoId);

  // ── 菜单悬停控制 ─────────────────────────────────────
  const handleMenuContainerEnter = (memoId) => {
    clearTimeout(hoverTimerRef.current);
    if (activeMenuId !== memoId) {
      hoverTimerRef.current = setTimeout(() => setActiveMenuId(memoId), 300);
    }
  };
  const handleMenuContainerLeave = () => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setActiveMenuId(null), 150);
  };
  const handleMenuButtonClick = (memoId) => {
    clearTimeout(hoverTimerRef.current);
    setActiveMenuId(activeMenuId === memoId ? null : memoId);
  };

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (activeMenuId && menuRefs.current[activeMenuId] && !menuRefs.current[activeMenuId].contains(event.target)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeMenuId]);

  // ── Ctrl+K 聚焦搜索框 ────────────────────────────────
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // ── 画布模式切换 ──────────────────────────────────────
  const handleCanvasModeToggle = useCallback(() => {
    const next = !isCanvasMode;
    setIsCanvasMode(next);
    if (next) {
      setIsLeftSidebarPinned(false);
      setIsRightSidebarPinned(false);
      toast.success('已进入画布模式，侧栏已自动取消固定');
    } else {
      toast.success('已退出画布模式');
    }
  }, [isCanvasMode]);

  // 画布模式下强制侧栏不固定
  useEffect(() => { if (isCanvasMode) { setIsLeftSidebarPinned(false); setIsRightSidebarPinned(false); } }, [isCanvasMode]);
  useEffect(() => { if (isCanvasMode && (isLeftSidebarPinned || isRightSidebarPinned)) { setIsLeftSidebarPinned(false); setIsRightSidebarPinned(false); } }, [isCanvasMode, isLeftSidebarPinned, isRightSidebarPinned]);

  // ── 自定义快捷键 ──────────────────────────────────────
  useEffect(() => {
    const parse = (shortcut) => {
      const parts = shortcut.split('+');
      const key   = parts[parts.length - 1];
      const keyMap = { Space: ' ', Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Backspace: 'Backspace' };
      return { key: keyMap[key] || key, ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') };
    };
    const check = (shortcut, e) => {
      const { key, ctrlKey, altKey, shiftKey } = parse(shortcut);
      return e.key === key && (e.ctrlKey || e.metaKey) === ctrlKey && e.altKey === altKey && e.shiftKey === shiftKey;
    };
    const h = (e) => {
      if (['INPUT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest?.('.shortcut-recording')) return;
      if (check(keyboardShortcuts.toggleSidebar, e)) {
        e.preventDefault();
        if (isCanvasMode) { toast.info('画布模式下不可固定侧栏'); return; }
        setIsLeftSidebarPinned(p => !p);
        setIsRightSidebarPinned(p => !p);
      }
      if (check(keyboardShortcuts.openAIDialog, e)) { e.preventDefault(); setIsAIDialogOpen(p => !p); }
      if (check(keyboardShortcuts.openSettings, e)) { e.preventDefault(); setIsSettingsOpen(true); }
      if (check(keyboardShortcuts.toggleCanvasMode, e)) { e.preventDefault(); handleCanvasModeToggle(); }
      if (check(keyboardShortcuts.openDailyReview, e)) { e.preventDefault(); setIsDailyReviewOpen(true); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isLeftSidebarPinned, isRightSidebarPinned, isAIDialogOpen, keyboardShortcuts, isCanvasMode, handleCanvasModeToggle]);

  // ── 日期点击 ──────────────────────────────────────────
  const handleDateClick = (dateStr) => { setActiveDate(dateStr === activeDate ? null : dateStr); setActiveTag(null); };
  const clearFilters   = () => { setActiveTag(null); setActiveDate(null); };
  const handleEditorFocus = () => setIsEditorFocused(true);
  const handleEditorBlur  = () => setIsEditorFocused(false);

  // ── AI 功能（续写 / 优化 / 对话）────────────────────
  const callAI = async ({ actionLabel, loadingId, systemPrompt, userPrompt, onSuccess }) => {
    if (!newMemo.trim()) { toast.error('请先输入一些内容'); return; }
    if (!aiConfig.enabled || !aiConfig.baseUrl || !aiConfig.apiKey) { toast.error('请先在设置中启用AI功能并配置API'); return; }
    try {
      toast.loading(`AI正在${actionLabel}中...`, { id: loadingId });
      const baseUrl = aiConfig.baseUrl.endsWith('/') ? aiConfig.baseUrl : aiConfig.baseUrl + '/';
      const res = await fetch(`${baseUrl}chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.apiKey}` },
        body: JSON.stringify({
          model: aiConfig.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
          max_tokens: 800, temperature: 0.8,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error?.message || `AI请求失败 (${res.status})`); }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) { onSuccess(text); toast.success(`AI${actionLabel}完成`, { id: loadingId }); }
      else toast.error('AI返回内容为空', { id: loadingId });
    } catch (error) {
      console.error(`AI${actionLabel}失败:`, error);
      toast.error(`AI${actionLabel}失败，请检查API配置`, { id: loadingId });
    }
  };

  const handleAIContinue = () => callAI({
    actionLabel: '续写', loadingId: 'ai-continue',
    systemPrompt: '你是一个专业的写作助手，擅长续写用户的想法和笔记。请根据用户输入的内容，自然地续写下去，保持风格一致。不要重复用户已经说过的话。',
    userPrompt: `请续写以下内容，保持原有风格和语调，不要重复原文：${newMemo}`,
    onSuccess: (text) => {
      const connector = newMemo.endsWith('。') || newMemo.endsWith('！') || newMemo.endsWith('？') ? ' ' : '';
      setNewMemo(prev => prev + connector + text);
    },
  });

  const handleAIOptimize = () => callAI({
    actionLabel: '优化', loadingId: 'ai-optimize',
    systemPrompt: '你是一个专业的文本优化助手，擅长改进用户的想法和笔记。请优化用户输入的内容，使其更加清晰、有条理和有表达力，但保持原意不变。',
    userPrompt: `请优化以下内容，保持原意不变，但提升表达清晰度和逻辑性：${newMemo}`,
    onSuccess: (text) => setNewMemo(text),
  });

  const handleAIChat = () => setIsAIDialogOpen(true);

  // ── 画布操作 ──────────────────────────────────────────
  const handleCanvasAddMemo = (memo) => {
    const now = new Date().toISOString();
    if (!memo.content.trim()) {
      const pinned = { ...memo, is_pinned: true, isPinned: true, pinnedAt: now };
      const nextPinned = [pinned, ...pinnedMemos];
      setPinnedMemos(nextPinned);
      persistLocally(memos, nextPinned);
      if (isAuthenticated) D1ApiClient.upsertUserSettings({ pinnedMemos: nextPinned, updated_at: now }).catch(console.error);
    } else {
      const nextMemos = [memo, ...memos];
      setMemos(nextMemos);
      persistLocally(nextMemos, pinnedMemos);
      if (isAuthenticated) D1ApiClient.upsertMemo(memo).catch(console.error);
    }
    _scheduleCloudSync?.('canvas-add');
  };

  const handleCanvasUpdateMemo = (id, updates) => {
    const now = new Date().toISOString();
    const upd = (list) => list.map(m => m.id === id ? { ...m, ...updates, updatedAt: now } : m);
    const nextMemos  = upd(memos);
    const nextPinned = upd(pinnedMemos);
    setMemos(nextMemos); setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    if (isAuthenticated) {
      const m = [...nextMemos, ...nextPinned].find(x => x.id === id);
      if (m) D1ApiClient.upsertMemo(m).catch(console.error);
      _scheduleCloudSync?.('canvas-update');
    }
  };

  const handleCanvasDeleteMemo = (id) => {
    const nextMemos  = memos.filter(m => m.id !== id);
    const nextPinned = pinnedMemos.filter(m => m.id !== id);
    setMemos(nextMemos); setPinnedMemos(nextPinned);
    persistLocally(nextMemos, nextPinned);
    addDeletedMemoTombstone(id);
    if (isAuthenticated) { D1ApiClient.deleteMemo(id).catch(console.error); _scheduleCloudSync?.('canvas-delete'); }
  };

  const handleCanvasTogglePin = (id) => {
    const now = new Date().toISOString();
    const inMemos  = memos.find(m => m.id === id);
    const inPinned = pinnedMemos.find(m => m.id === id);
    if (inMemos) {
      const pinned = { ...inMemos, is_pinned: true, isPinned: true, pinnedAt: now, updatedAt: now, lastModified: now };
      const nextPinned = [pinned, ...pinnedMemos];
      const nextMemos  = memos.filter(m => m.id !== id);
      setPinnedMemos(nextPinned); setMemos(nextMemos);
      persistLocally(nextMemos, nextPinned);
      if (isAuthenticated) {
        const ids = nextPinned.map(m => m.id);
        D1ApiClient.updateMemoMeta(id, { is_pinned: true, pinned_at: now }).catch(console.error);
        D1ApiClient.updatePinnedIds(ids).catch(console.error);
        _scheduleCloudSync?.('canvas-pin');
      }
    } else if (inPinned) {
      const unpinned = { ...inPinned, is_pinned: false, isPinned: false, pinnedAt: null, updatedAt: now, lastModified: now };
      delete unpinned.pinnedAt;
      const nextMemos  = [unpinned, ...memos];
      const nextPinned = pinnedMemos.filter(m => m.id !== id);
      setMemos(nextMemos); setPinnedMemos(nextPinned);
      persistLocally(nextMemos, nextPinned);
      if (isAuthenticated) {
        const ids = nextPinned.map(m => m.id);
        D1ApiClient.updateMemoMeta(id, { is_pinned: false, pinned_at: null }).catch(console.error);
        D1ApiClient.updatePinnedIds(ids).catch(console.error);
        D1ApiClient.upsertMemo(unpinned).catch(console.error);
        _scheduleCloudSync?.('canvas-unpin');
      }
    }
  };

  // ── 随机背景 ──────────────────────────────────────────
  useEffect(() => {
    if (!backgroundConfig?.useRandom || backgroundConfig?.imageUrl) { setCurrentRandomBgUrl(''); return; }
    if (currentRandomBgUrl) return;
    let aborted = false;
    (async () => {
      try {
        const api = '/api/proxy-fetch?url=' + encodeURIComponent('https://imgapi.xl0408.top/index.php');
        const res = await fetch(api);
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (!aborted && data?.dataUrl) { setCurrentRandomBgUrl(data.dataUrl); return; }
        }
        if (!aborted) setCurrentRandomBgUrl('https://imgapi.xl0408.top/index.php');
      } catch { }
    })();
    return () => { aborted = true; };
  }, [backgroundConfig?.useRandom, backgroundConfig?.imageUrl, currentRandomBgUrl]);

  const effectiveBgUrl = backgroundConfig.imageUrl || (backgroundConfig.useRandom ? currentRandomBgUrl : '');
  const backgroundStyle = effectiveBgUrl ? {
    backgroundImage: `url(${effectiveBgUrl})`, backgroundSize: 'cover',
    backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    filter: `brightness(${backgroundConfig.brightness}%)`,
  } : {};
  const overlayStyle = effectiveBgUrl ? {
    backdropFilter: `blur(${backgroundConfig.blur}px)`,
    backgroundColor: 'rgba(255,255,255,0.1)',
  } : {};

  const handleFavoriteRandomBackground = () => {
    if (!backgroundConfig.useRandom || backgroundConfig.imageUrl || !currentRandomBgUrl) return;
    updateBackgroundConfig({ imageUrl: currentRandomBgUrl, useRandom: false });
    toast.success('已收藏并设置为背景');
  };

  // ── Render ────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col lg:flex-row lg:overflow-hidden lg:h-screen relative">
      {effectiveBgUrl && <div className="absolute inset-0 z-0" style={backgroundStyle} />}
      {effectiveBgUrl && <div className="absolute inset-0 z-0" style={overlayStyle} />}

      <div className="relative z-10 min-h-screen lg:h-full w-full flex flex-col lg:flex-row">

        <LeftSidebar
          heatmapData={heatmapData}
          memos={isAuthenticated ? memos : memos.filter(m => m.is_public)}
          pinnedMemos={isAuthenticated ? pinnedMemos : pinnedMemos.filter(m => m.is_public)}
          isLeftSidebarHidden={isLeftSidebarHidden}
          setIsLeftSidebarHidden={setIsLeftSidebarHidden}
          isLeftSidebarPinned={isLeftSidebarPinned}
          setIsLeftSidebarPinned={setIsLeftSidebarPinned}
          isLeftSidebarHovered={isLeftSidebarHovered}
          isAppLoaded={isAppLoaded}
          isInitialLoad={isInitialLoad}
          isCanvasMode={isCanvasMode}
          setIsCanvasMode={setIsCanvasMode}
          onSettingsOpen={() => setIsSettingsOpen(true)}
          onDateClick={handleDateClick}
          onOpenDailyReview={() => setIsDailyReviewOpen(true)}
          showFavoriteRandomButton={backgroundConfig.useRandom && !backgroundConfig.imageUrl}
          onFavoriteRandomBackground={handleFavoriteRandomBackground}
          isAuthenticated={isAuthenticated}
        />

        {isCanvasMode ? (
          <CanvasMode
            memos={memos}
            pinnedMemos={pinnedMemos}
            onAddMemo={handleCanvasAddMemo}
            onUpdateMemo={handleCanvasUpdateMemo}
            onDeleteMemo={handleCanvasDeleteMemo}
            onTogglePin={handleCanvasTogglePin}
            onToolPanelVisibleChange={setCanvasToolPanelVisible}
          />
        ) : (
          <MainContent
            isLeftSidebarHidden={isLeftSidebarHidden}
            isRightSidebarHidden={isRightSidebarHidden}
            setIsLeftSidebarHidden={setIsLeftSidebarHidden}
            setIsRightSidebarHidden={setIsRightSidebarHidden}
            isLeftSidebarPinned={isLeftSidebarPinned}
            isRightSidebarPinned={isRightSidebarPinned}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            newMemo={newMemo}
            setNewMemo={setNewMemo}
            filteredMemos={filteredMemos}
            pinnedMemos={pinnedMemos}
            activeMenuId={activeMenuId}
            editingId={editingId}
            editContent={editContent}
            activeTag={activeTag}
            activeDate={activeDate}
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
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onTagClick={setActiveTag}
            onScrollToTop={scrollToTop}
            clearFilters={clearFilters}
            onEditorFocus={handleEditorFocus}
            onEditorBlur={handleEditorBlur}
            allMemos={[...memos, ...pinnedMemos]}
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
          memos={[...memos, ...pinnedMemos]}
          activeTag={activeTag}
          setActiveTag={(tag) => { setActiveTag(tag); setActiveDate(null); }}
          isRightSidebarHidden={isRightSidebarHidden}
          setIsRightSidebarHidden={setIsRightSidebarHidden}
          isRightSidebarPinned={isRightSidebarPinned}
          setIsRightSidebarPinned={setIsRightSidebarPinned}
          isRightSidebarHovered={isRightSidebarHovered}
          isAppLoaded={isAppLoaded}
          isInitialLoad={isInitialLoad}
          isCanvasMode={isCanvasMode}
        />
      </div>

      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        heatmapData={heatmapData}
        memos={isAuthenticated ? [...memos, ...pinnedMemos] : [...memos, ...pinnedMemos].filter(m => m.is_public)}
        activeTag={activeTag}
        setActiveTag={(tag) => { setActiveTag(tag); setActiveDate(null); }}
        onSettingsOpen={() => setIsSettingsOpen(true)}
        onDateClick={handleDateClick}
        isAuthenticated={isAuthenticated}
        onOpenMusic={() => { if (musicConfig?.enabled) setMusicModal(m => ({ ...m, isOpen: true })); }}
      />

      <SettingsCard isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onOpenTutorial={() => setIsTutorialOpen(true)} />
      <ShareDialog   isOpen={isShareDialogOpen} onClose={() => setIsShareDialogOpen(false)} memo={selectedMemo} />
      <AIDialog      isOpen={isAIDialogOpen}    onClose={() => setIsAIDialogOpen(false)}    memos={[...memos, ...pinnedMemos]} />
      <DailyReview   isOpen={isDailyReviewOpen} onClose={() => setIsDailyReviewOpen(false)} memos={[...memos, ...pinnedMemos]} />
      <TutorialDialog isOpen={isTutorialOpen}   onClose={() => setIsTutorialOpen(false)} />
      <MemoPreviewDialog
        memo={[...memos, ...pinnedMemos].find(m => m.id === previewMemoId) || null}
        open={!!previewMemoId}
        onClose={() => setPreviewMemoId(null)}
      />

      {musicConfig?.enabled && (
        <>
          <MusicModal
            isOpen={musicModal.isOpen}
            onClose={() => setMusicModal(m => ({ ...m, isOpen: false }))}
            danmakuText={musicModal.danmakuText}
            enableDanmaku={musicModal.enableDanmaku}
          />
          {!isCanvasMode && <MiniMusicPlayer onOpenFull={() => setMusicModal(m => ({ ...m, isOpen: true }))} />}
          <MusicSearchCard open={musicSearchOpen} keyword={musicSearchKeyword} onClose={() => setMusicSearchOpen(false)} />
        </>
      )}

      {!isCanvasMode && isAuthenticated && (
        <AIButton
          isSettingsOpen={isSettingsOpen}
          isShareDialogOpen={isShareDialogOpen}
          isEditorFocused={isEditorFocused}
          onContinue={handleAIContinue}
          onOptimize={handleAIOptimize}
          onChat={handleAIChat}
        />
      )}
    </div>
  );
};

export default Index;
