import { useEffect, useRef } from 'react';

import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchAppConfig, fetchCurrentUser, toggleChatHistory } from './store/appSlice';
import { ChatPanel } from './components/ChatPanel';
import { ChatHistory } from './components/ChatHistory';
import { AppHeader } from './components/AppHeader';
import { useChatOrchestrator } from './hooks/useChatOrchestrator';
import { useContentGeneration } from './hooks/useContentGeneration';
import { useConversationActions } from './hooks/useConversationActions';


function App() {
  const dispatch = useAppDispatch();

  // Select state from Redux store
  const { userName, imageGenerationEnabled, showChatHistory } = useAppSelector(state => state.app);
  const { conversationId, conversationTitle, messages, isLoading, generationStatus, historyRefreshTrigger } = useAppSelector(state => state.chat);
  const { pendingBrief, confirmedBrief, selectedProducts, availableProducts, generatedContent } = useAppSelector(state => state.content);

  // Abort controller for cancelling ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Custom hooks for business logic
  const { handleSendMessage } = useChatOrchestrator(abortControllerRef);
  const { handleGenerateContent } = useContentGeneration(abortControllerRef);
  const {
    handleBriefConfirm,
    handleBriefCancel,
    handleProductSelect,
    handleStopGeneration,
    handleSelectConversation,
    handleNewConversation,
  } = useConversationActions(abortControllerRef);

  // Fetch app config and user info on mount
  useEffect(() => {
    dispatch(fetchAppConfig());
    dispatch(fetchCurrentUser());
  }, [dispatch]);

  return (
    <div className="app-container">
      {/* Header */}
      <AppHeader
        userName={userName}
        showChatHistory={showChatHistory}
        onToggleChatHistory={() => dispatch(toggleChatHistory())}
      />
      
      {/* Main Content */}
      <div className="main-content">
        {/* Chat Panel - main area */}
        <div className="chat-panel">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            generationStatus={generationStatus}
            onStopGeneration={handleStopGeneration}
            pendingBrief={pendingBrief}
            confirmedBrief={confirmedBrief}
            generatedContent={generatedContent}
            selectedProducts={selectedProducts}
            availableProducts={availableProducts}
            onBriefConfirm={handleBriefConfirm}
            onBriefCancel={handleBriefCancel}
            onGenerateContent={handleGenerateContent}
            onRegenerateContent={handleGenerateContent}
            onProductSelect={handleProductSelect}
            imageGenerationEnabled={imageGenerationEnabled}
            onNewConversation={handleNewConversation}
          />
        </div>
        
        {/* Chat History Sidebar - RIGHT side */}
        {showChatHistory && (
          <div className="history-panel">
            <ChatHistory
              currentConversationId={conversationId}
              currentConversationTitle={conversationTitle}
              currentMessages={messages}
              onSelectConversation={handleSelectConversation}
              onNewConversation={handleNewConversation}
              refreshTrigger={historyRefreshTrigger}
              isGenerating={isLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
