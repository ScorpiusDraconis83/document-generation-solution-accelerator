/**
 * Barrel export for the Redux store.
 * Import everything you need from '../store'.
 */
export { store } from './store';
export type { RootState, AppDispatch } from './store';
export { useAppDispatch, useAppSelector } from './hooks';

// App slice – actions & thunks
export {
  fetchAppConfig,
  fetchUserInfo,
  setIsLoading,
  setGenerationStatus,
  toggleChatHistory,
  setShowChatHistory,
} from './appSlice';

// Chat slice – actions
export {
  setConversationId,
  setConversationTitle,
  setMessages,
  addMessage,
  setAwaitingClarification,
  incrementHistoryRefresh,
  resetChat,
} from './chatSlice';

// Content slice – actions
export {
  setPendingBrief,
  setConfirmedBrief,
  setSelectedProducts,
  setAvailableProducts,
  setGeneratedContent,
  resetContent,
} from './contentSlice';

// Chat History slice – actions & thunks
export {
  fetchConversations,
  deleteConversation,
  renameConversation,
  clearAllConversations,
  setShowAll,
  setConversations,
  upsertConversation,
  setIsClearAllDialogOpen,
} from './chatHistorySlice';
export type { ConversationSummary } from './chatHistorySlice';

// All selectors (centralized to avoid circular store ↔ slice imports)
export {
  selectUserId,
  selectUserName,
  selectIsLoading,
  selectGenerationStatus,
  selectImageGenerationEnabled,
  selectShowChatHistory,
  selectConversationId,
  selectConversationTitle,
  selectMessages,
  selectAwaitingClarification,
  selectHistoryRefreshTrigger,
  selectPendingBrief,
  selectConfirmedBrief,
  selectSelectedProducts,
  selectAvailableProducts,
  selectGeneratedContent,
  selectConversations,
  selectIsHistoryLoading,
  selectHistoryError,
  selectShowAll,
  selectIsClearAllDialogOpen,
  selectIsClearing,
} from './selectors';
