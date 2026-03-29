import React from 'react';
import { ChevronLeft, ChevronRight, X, ArrowUp } from 'lucide-react';
import Header from '@/components/Header';
import MemoInput from '@/components/MemoInput';
import MemoList from '@/components/MemoList';
import { useTheme } from '@/context/ThemeContext';

const MainContent = ({
  // Layout state
  isLeftSidebarHidden,
  isRightSidebarHidden,
  setIsLeftSidebarHidden,
  setIsRightSidebarHidden,
  isLeftSidebarPinned,
  isRightSidebarPinned,

  // Data
  searchQuery,
  setSearchQuery,
  newMemo,
  setNewMemo,
  filteredMemos,
  pinnedMemos,
  activeMenuId,
  editingId,
  editContent,
  activeTag,
  activeDate, // 新增日期筛选状态
  showScrollToTop,

  // Refs
  searchInputRef,
  memosContainerRef,
  menuRefs,

  // Callbacks
  onMobileMenuOpen,
  onAddMemo,
  onMenuAction,
  onMenuContainerEnter,
  onMenuContainerLeave,
  onMenuButtonClick,
  onEditContentChange,
  onSaveEdit,
  onCancelEdit,
  onTagClick,
  onScrollToTop,
  clearFilters, // 新增清除筛选函数
  onEditorFocus,
  onEditorBlur,
  onOpenMusic,
  onOpenMusicSearch,
  musicEnabled = true,
  // backlinks
  allMemos,
  onAddBacklink,
  onPreviewMemo,
  pendingNewBacklinks,
  onRemoveBacklink,
  // audio
  onAddAudioClip,
  pendingNewAudioClips,
  onRemoveAudioClip,
  // 认证状态
  isAuthenticated = true
}) => {
  const { themeColor } = useTheme();

  return (
    <div className={`flex-1 flex flex-col w-full relative h-full lg:h-full ${
      isLeftSidebarPinned && isRightSidebarPinned
        ? 'lg:max-w-4xl lg:mx-auto'
        : isLeftSidebarPinned || isRightSidebarPinned
          ? 'lg:max-w-4xl lg:mx-auto'
          : 'lg:max-w-4xl lg:mx-auto px-4'
    }`}>

      <div ref={memosContainerRef} className="flex-1 overflow-y-auto scrollbar-hidden relative">
        <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
          <Header
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchInputRef={searchInputRef}
            onMobileMenuOpen={onMobileMenuOpen}
            onOpenMusicSearch={onOpenMusicSearch}
          />

          {isAuthenticated && (
            <MemoInput
              newMemo={newMemo}
              setNewMemo={setNewMemo}
              onAddMemo={onAddMemo}
              onEditorFocus={onEditorFocus}
              onEditorBlur={onEditorBlur}
              allMemos={allMemos}
              onAddBacklink={onAddBacklink}
              onPreviewMemo={onPreviewMemo}
              pendingNewBacklinks={pendingNewBacklinks}
              onRemoveBacklink={onRemoveBacklink}
              onAddAudioClip={onAddAudioClip}
              audioClips={pendingNewAudioClips}
              onRemoveAudioClip={onRemoveAudioClip}
              isAuthenticated={isAuthenticated}
            />
          )}

          <MemoList
            memos={filteredMemos}
            pinnedMemos={pinnedMemos}
            activeMenuId={activeMenuId}
            editingId={editingId}
            editContent={editContent}
            activeTag={activeTag}
            activeDate={activeDate}
            showScrollToTop={showScrollToTop}
            menuRefs={menuRefs}
            memosContainerRef={memosContainerRef}
            onMenuAction={onMenuAction}
            onMenuContainerEnter={onMenuContainerEnter}
            onMenuContainerLeave={onMenuContainerLeave}
            onMenuButtonClick={onMenuButtonClick}
            onEditContentChange={onEditContentChange}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            onTagClick={onTagClick}
            onScrollToTop={onScrollToTop}
            clearFilters={clearFilters}
            allMemos={allMemos}
            onAddBacklink={onAddBacklink}
            onPreviewMemo={onPreviewMemo}
            onRemoveBacklink={onRemoveBacklink}
            onAddAudioClip={onAddAudioClip}
            onRemoveAudioClip={onRemoveAudioClip}
            isAuthenticated={isAuthenticated}
          />
        </div>

        {showScrollToTop && (
          <button
            onClick={onScrollToTop}
            className="absolute bottom-6 right-6 z-30 flex items-center justify-center w-12 h-12 rounded-full bg-gray-200/90 dark:bg-gray-700/90 text-gray-700 dark:text-gray-300 transition-all duration-300 hover:bg-gray-300/90 dark:hover:bg-gray-600/90 hover:scale-110 shadow-lg backdrop-blur-sm border border-gray-300/20 dark:border-gray-600/20"
            aria-label="回到顶部"
            title="回到顶部"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default MainContent;
