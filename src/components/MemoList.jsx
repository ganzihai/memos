import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, MoreVertical, ArrowUp, X, Image, Globe, Lock, Paperclip, File } from 'lucide-react';
import MemoEditor from '@/components/MemoEditor';
import ContentRenderer from '@/components/ContentRenderer';
import { useTheme } from '@/context/ThemeContext';
import fileStorageService from '@/lib/fileStorageService';

const MemoList = ({
  memos,
  pinnedMemos,
  activeMenuId,
  editingId,
  editContent,
  activeTag,
  activeDate,
  showScrollToTop,
  menuRefs,
  memosContainerRef,
  onMenuAction,
  onMenuContainerEnter,
  onMenuContainerLeave,
  onMenuButtonClick,
  onEditContentChange,
  onSaveEdit,
  onCancelEdit,
  onTagClick,
  onScrollToTop,
  clearFilters,
  allMemos = [],
  onAddBacklink,
  onPreviewMemo,
  onRemoveBacklink,
  onAddAudioClip,
  onRemoveAudioClip,
  isAuthenticated = true
}) => {
  const { themeColor } = useTheme();

  // pinnedMemos id set，用于从 normalMemos 中排除
  const pinnedIdSet = new Set((Array.isArray(pinnedMemos) ? pinnedMemos : []).map(m => m.id));
  // filteredMemos 中排除已置顶的 memo，避免重复渲染
  const normalMemos = (Array.isArray(memos) ? memos : []).filter(m => !pinnedIdSet.has(m.id));
  const safePinned  = Array.isArray(pinnedMemos) ? pinnedMemos : [];

  const memosForBacklinks = (allMemos && allMemos.length) ? allMemos : [...safePinned, ...normalMemos];
  const editingWrapperRef = useRef(null);
  const [audioUrls, setAudioUrls]     = useState({});
  const audioRefs  = useRef({});
  const [playing, setPlaying]         = useState({});
  const [expandedMemos, setExpandedMemos] = useState({});

  const formatMs = (ms) => {
    if (!ms && ms !== 0) return '';
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const resolveAll = async () => {
      const next = { ...audioUrls };
      for (const memo of [...safePinned, ...normalMemos]) {
        const clips = Array.isArray(memo.audioClips) ? memo.audioClips : [];
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          const key  = `${memo.id}:${i}`;
          if (next[key]) continue;
          if (clip?.url) { next[key] = clip.url; continue; }
          if (clip?.storageType === 'base64' && clip?.data) { next[key] = clip.data; continue; }
          if (clip?.storageType === 'indexeddb' && clip?.id) {
            try { const r = await fileStorageService.restoreFile(clip); if (r?.data) next[key] = r.data; } catch {}
          }
        }
      }
      setAudioUrls(next);
    };
    resolveAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memos, pinnedMemos]);

  const getMenuPosition = (memoId) => {
    const el = menuRefs.current[memoId];
    if (!el) return { style: { opacity: 0 } };
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const mw = 192;
    const style = { top: r.bottom + 5, opacity: 1 };
    if (vw - r.right < mw) { style.left = r.left - mw + r.width; style.right = 'auto'; }
    else { style.right = vw - r.right; style.left = 'auto'; }
    return { style };
  };

  useEffect(() => {
    if (!editingId) return;
    const h = (e) => { const el = editingWrapperRef.current; if (!el || el.contains(e.target)) return; try { onSaveEdit?.(editingId); } catch {} };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h, { passive: true });
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); };
  }, [editingId, onSaveEdit]);

  const toggleExpand = (id) => setExpandedMemos(p => ({ ...p, [id]: !p[id] }));

  const extractAttachments = (content) => {
    const attachments = [];
    const lines = (content || '').split('\n');
    const newLines = [];
    // 只提取"整行就是一个裸URL"的情况，带文字描述的 [text](url) 保留在正文
    const bareUrlRe = /^(https?:\/\/\S+)$/;
    for (const line of lines) {
      const trimmed = line.trim();
      if (bareUrlRe.test(trimmed)) {
        attachments.push({ name: trimmed, url: trimmed });
      } else {
        newLines.push(line);
      }
    }
    return { attachments, newContent: newLines.join('\n').trim() };
  };

  const MAX_LEN = 200;

  // ─── 单条卡片渲染 ────────────────────────────────────────────────────────────
  const renderMemo = (memo, isPinned = false) => {
    const { attachments, newContent } = extractAttachments(memo.content);
    return (
      <Card
        key={memo.id}
        className={`group hover:shadow-md transition-shadow rounded-xl shadow-sm relative bg-white dark:bg-gray-800 ${
          isPinned ? 'border-l-4' : ''
        }`}
        style={isPinned ? { borderLeftColor: themeColor } : {}}
      >
        <CardContent className="p-3 sm:p-4">

          {/* 菜单按钮 */}
          {isAuthenticated && (
            <div
              className="absolute top-3 right-3 sm:top-4 sm:right-4"
              ref={(el) => menuRefs.current[memo.id] = el}
              onMouseEnter={() => onMenuContainerEnter(memo.id)}
              onMouseLeave={onMenuContainerLeave}
            >
              <button
                onClick={() => onMenuButtonClick(memo.id)}
                className="p-1 rounded-full hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 touch:opacity-100"
                aria-label="操作菜单"
              >
                <MoreVertical className="h-4 w-4 text-gray-500" />
              </button>

              {activeMenuId === memo.id && (
                <div
                  className="fixed w-40 sm:w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 z-50 border border-gray-200 dark:border-gray-700 transition-opacity duration-150"
                  onClick={(e) => e.stopPropagation()}
                  style={getMenuPosition(memo.id).style}
                >
                  <button onClick={(e) => onMenuAction(e, memo.id, 'toggle-public')}
                    className="block w-full text-left px-3 py-2 sm:px-4 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center">
                    {memo.is_public
                      ? <><Lock className="h-4 w-4 mr-2 flex-shrink-0" /><span className="truncate">设为私有</span></>
                      : <><Globe className="h-4 w-4 mr-2 flex-shrink-0" /><span className="truncate">设为公开</span></>}
                  </button>

                  {isPinned ? (
                    <button onClick={(e) => onMenuAction(e, memo.id, 'unpin')}
                      className="block w-full text-left px-3 py-2 sm:px-4 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 12l3-3 3 3M8 21l4-7 4 7M16 3h5v5M21 3l-7.5 7.5" />
                      </svg>
                      <span className="truncate">取消置顶</span>
                    </button>
                  ) : (
                    <button onClick={(e) => onMenuAction(e, memo.id, 'pin')}
                      className="block w-full text-left px-3 py-2 sm:px-4 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" />
                      </svg>
                      <span className="truncate">置顶</span>
                    </button>
                  )}

                  <button onClick={(e) => onMenuAction(e, memo.id, 'edit')}
                    className="block w-full text-left px-3 py-2 sm:px-4 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span className="truncate">编辑</span>
                  </button>

                  <button onClick={(e) => onMenuAction(e, memo.id, 'share')}
                    className="block w-full text-left px-3 py-2 sm:px-4 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center">
                    <Image className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span className="truncate">分享图</span>
                  </button>

                  <button onClick={(e) => onMenuAction(e, memo.id, 'delete')}
                    className="block w-full text-left px-3 py-2 sm:px-4 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span className="truncate">删除</span>
                  </button>

                  <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1 px-3 py-2 sm:px-4 text-xs text-gray-500 dark:text-gray-400">
                    <div className="truncate">字数: {memo.content.length}字</div>
                    <div className="truncate">创建: {new Date(memo.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="truncate">修改: {new Date(memo.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 内容区 */}
          {editingId === memo.id && isAuthenticated ? (
            <div className="mb-4" ref={editingWrapperRef}>
              <MemoEditor
                value={editContent}
                onChange={onEditContentChange}
                placeholder="编辑想法..."
                maxLength={5000}
                showCharCount={true}
                autoFocus={true}
                memosList={memosForBacklinks}
                currentMemoId={memo.id}
                backlinks={Array.isArray(memo.backlinks) ? memo.backlinks : []}
                onAddBacklink={onAddBacklink}
                onPreviewMemo={onPreviewMemo}
                onRemoveBacklink={onRemoveBacklink}
                audioClips={Array.isArray(memo.audioClips) ? memo.audioClips : []}
                onRemoveAudioClip={onRemoveAudioClip}
                onAddAudioClip={onAddAudioClip}
                onSubmit={() => onSaveEdit(memo.id)}
              />
            </div>
          ) : (
            <>
              {newContent.length > MAX_LEN && !expandedMemos[memo.id] ? (
                <div className="custom-font-content">
                  <div className="relative overflow-hidden" style={{ maxHeight: '180px' }}>
                    <ContentRenderer content={newContent} activeTag={activeTag} onTagClick={onTagClick} />
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white dark:from-gray-800 to-transparent pointer-events-none" />
                  </div>
                  <div className="mt-2">
                    <button onClick={() => toggleExpand(memo.id)} className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 font-medium">展开全文</button>
                  </div>
                </div>
              ) : (
                <div className="custom-font-content">
                  <ContentRenderer content={newContent} activeTag={activeTag} onTagClick={onTagClick} />
                  {newContent.length > MAX_LEN && expandedMemos[memo.id] && (
                    <div className="mt-2">
                      <button onClick={() => toggleExpand(memo.id)} className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 font-medium">收起</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* 反链 */}
          {Array.isArray(memo.backlinks) && memo.backlinks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {memo.backlinks.map((bid) => {
                const bm = memosForBacklinks.find(x => x.id === bid);
                if (!bm) return null;
                return (
                  <span key={`${memo.id}-bk-${bid}`} className="inline-flex items-center group">
                    <button type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPreviewMemo?.(bid); }}
                      className="max-w-full inline-flex items-center gap-1 pl-2 pr-2 py-0.5 rounded-md bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span className="truncate inline-block max-w-[200px]">{bm.content?.replace(/\n/g, ' ').slice(0, 60) || '（无内容）'}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-70">
                        <path d="M7 17L17 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M9 7H17V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <button type="button"
                      className="ml-1 w-4 h-4 rounded hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 dark:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveBacklink?.(memo.id, bid); }}
                      aria-label="移除反链"
                    >×</button>
                  </span>
                );
              })}
            </div>
          )}

          {/* 音频 */}
          {Array.isArray(memo.audioClips) && memo.audioClips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {memo.audioClips.map((clip, idx) => {
                const key = `${memo.id}:${idx}`;
                const src = clip?.url || clip?.data || audioUrls[key] || '';
                const isPlaying = !!playing[key];
                return (
                  <span key={key} className="inline-flex items-center group">
                    <button type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); const el = audioRefs.current[key]; if (!el) return; if (el.paused) { el.play(); setPlaying(p => ({ ...p, [key]: true })); } else { el.pause(); setPlaying(p => ({ ...p, [key]: false })); } }}
                      className="max-w-full inline-flex items-center gap-1 pl-2 pr-2 py-0.5 rounded-md bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      {isPlaying
                        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor" /></svg>
                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M8 5l12 7-12 7V5z" fill="currentColor" /></svg>
                      }
                      <span className="truncate inline-block max-w-[200px]">录音{clip?.durationMs ? ` · ${formatMs(clip.durationMs)}` : ''}</span>
                    </button>
                    <audio ref={(el) => { if (el) audioRefs.current[key] = el; }} src={src} style={{ display: 'none' }} onEnded={() => setPlaying(p => ({ ...p, [key]: false }))} />
                  </span>
                );
              })}
            </div>
          )}

          {/* 附件 */}
          {attachments.length > 0 && (
            <div className="mt-3 border rounded-lg border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center text-xs font-medium text-gray-500 dark:text-gray-400">
                <Paperclip className="w-3.5 h-3.5 mr-1.5" />附件 ({attachments.length})
              </div>
              <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white dark:bg-gray-800">
                {attachments.map((att, idx) => {
                  const ext = (att.name.match(/\.([^.]+)$/) || ['', 'FILE'])[1].toUpperCase();
                  return (
                    <a key={idx} href={att.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center p-2 rounded-md border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                      <div className="w-8 h-8 rounded bg-gray-100 dark:bg-gray-700 flex items-center justify-center mr-3 flex-shrink-0 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30">
                        <File className="w-4 h-4 text-gray-500 group-hover:text-blue-500" />
                      </div>
                      <div className="flex flex-col overflow-hidden min-w-0">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{att.name}</span>
                        <span className="text-[10px] text-gray-400 mt-0.5">{ext}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* 底部：公开状态 + 时间 */}
          <div className="mt-3 flex items-center justify-end space-x-2">
            {isAuthenticated && (
              memo.is_public
                ? <Globe className="h-4 w-4 text-green-600 dark:text-green-400" title="公开" />
                : <Lock  className="h-4 w-4 text-gray-500 dark:text-gray-400"   title="私有" />
            )}
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {new Date(memo.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // 全部为空时的提示
  const isEmpty = safePinned.length === 0 && normalMemos.length === 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 mobile-memos-container lg:mobile-memos-container-disabled min-h-[250px]">
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 py-10">
            <div className="text-center">
              <p>还没有记录任何想法</p>
              <p className="text-sm mt-2">在顶部输入框写下你的第一个想法吧</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-4">

            {/* ── 置顶区 ── */}
            {safePinned.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: themeColor }}>
                    <path d="M9 12l2 2 4-4M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" />
                  </svg>
                  <span className="text-xs font-medium" style={{ color: themeColor }}>置顶</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: `${themeColor}30` }} />
                </div>
                {safePinned.map(m => renderMemo(m, true))}
                {normalMemos.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-400">其他</span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  </div>
                )}
              </>
            )}

            {/* ── 普通区 ── */}
            {normalMemos.map(m => renderMemo(m, false))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MemoList;
