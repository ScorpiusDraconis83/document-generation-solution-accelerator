import { useState, useMemo, useCallback, memo } from 'react';
import type { Product } from '../types';
import { BriefReview } from './BriefReview';
import { ConfirmedBriefView } from './ConfirmedBriefView';
import { SelectedProductView } from './SelectedProductView';
import { ProductReview } from './ProductReview';
import { InlineContentPreview } from './InlineContentPreview';
import { WelcomeCard } from './WelcomeCard';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatInput } from './ChatInput';
import { useAutoScroll } from '../hooks/useAutoScroll';
import {
  useAppSelector,
  selectMessages,
  selectIsLoading,
  selectGenerationStatus,
  selectPendingBrief,
  selectConfirmedBrief,
  selectGeneratedContent,
  selectSelectedProducts,
  selectAvailableProducts,
  selectImageGenerationEnabled,
} from '../store';

interface ChatPanelProps {
  onSendMessage: (message: string) => void;
  onStopGeneration?: () => void;
  onBriefConfirm?: () => void;
  onBriefCancel?: () => void;
  onGenerateContent?: () => void;
  onRegenerateContent?: () => void;
  onProductsStartOver?: () => void;
  onProductSelect?: (product: Product) => void;
  onNewConversation?: () => void;
}

export const ChatPanel = memo(function ChatPanel({ 
  onSendMessage, 
  onStopGeneration,
  onBriefConfirm,
  onBriefCancel,
  onGenerateContent,
  onRegenerateContent,
  onProductsStartOver,
  onProductSelect,
  onNewConversation,
}: ChatPanelProps) {
  const messages = useAppSelector(selectMessages);
  const isLoading = useAppSelector(selectIsLoading);
  const generationStatus = useAppSelector(selectGenerationStatus);
  const pendingBrief = useAppSelector(selectPendingBrief);
  const confirmedBrief = useAppSelector(selectConfirmedBrief);
  const generatedContent = useAppSelector(selectGeneratedContent);
  const selectedProducts = useAppSelector(selectSelectedProducts);
  const availableProducts = useAppSelector(selectAvailableProducts);
  const imageGenerationEnabled = useAppSelector(selectImageGenerationEnabled);

  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when messages or state changes
  const messagesEndRef = useAutoScroll([
    messages, pendingBrief, confirmedBrief, generatedContent, isLoading, generationStatus,
  ]);

  // Determine if we should show inline components
  const showBriefReview = useMemo(
    () => !!(pendingBrief && onBriefConfirm && onBriefCancel),
    [pendingBrief, onBriefConfirm, onBriefCancel],
  );
  const showProductReview = useMemo(
    () => !!(confirmedBrief && !generatedContent && onGenerateContent),
    [confirmedBrief, generatedContent, onGenerateContent],
  );
  const showContentPreview = useMemo(
    () => !!(generatedContent && onRegenerateContent),
    [generatedContent, onRegenerateContent],
  );
  const showWelcome = useMemo(
    () => messages.length === 0 && !showBriefReview && !showProductReview && !showContentPreview,
    [messages.length, showBriefReview, showProductReview, showContentPreview],
  );

  // Handle suggestion click from welcome card
  const handleSuggestionClick = useCallback((prompt: string) => {
    setInputValue(prompt);
  }, []);

  const isInputDisabled = useMemo(() => isLoading, [isLoading]);

  const startOverFallback = useCallback(() => {}, []);
  const effectiveProductsStartOver = onProductsStartOver || startOverFallback;

  return (
    <div className="chat-container">
      {/* Messages Area */}
      <div 
        className="messages"
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          overflowX: 'hidden',
          padding: '8px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minHeight: 0,
          position: 'relative',
        }}
      >
        {showWelcome ? (
          <WelcomeCard onSuggestionClick={handleSuggestionClick} currentInput={inputValue} />
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            
            {/* Brief Review - Read Only with Conversational Prompts */}
            {showBriefReview && (
              <BriefReview
                brief={pendingBrief!}
                onConfirm={onBriefConfirm!}
                onStartOver={onBriefCancel!}
                isAwaitingResponse={isLoading}
              />
            )}
            
            {/* Confirmed Brief View - Persistent read-only view */}
            {confirmedBrief && !pendingBrief && (
              <ConfirmedBriefView brief={confirmedBrief} />
            )}
            
            {/* Selected Product View - Persistent read-only view after content generation */}
            {generatedContent && selectedProducts.length > 0 && (
              <SelectedProductView products={selectedProducts} />
            )}
            
            {/* Product Review - Conversational Product Selection */}
            {showProductReview && (
              <ProductReview
                products={selectedProducts}
                availableProducts={availableProducts}
                onConfirm={onGenerateContent!}
                onStartOver={effectiveProductsStartOver}
                isAwaitingResponse={isLoading}
                onProductSelect={onProductSelect}
                disabled={isLoading}
              />
            )}
            
            {/* Inline Content Preview */}
            {showContentPreview && (
              <InlineContentPreview
                content={generatedContent!}
                onRegenerate={onRegenerateContent!}
                isLoading={isLoading}
                selectedProduct={selectedProducts.length > 0 ? selectedProducts[0] : undefined}
                imageGenerationEnabled={imageGenerationEnabled}
              />
            )}
            
            {/* Loading/Typing Indicator */}
            {isLoading && (
              <TypingIndicator
                statusText={generationStatus}
                onStop={onStopGeneration}
              />
            )}
          </>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <ChatInput
        onSendMessage={onSendMessage}
        onNewConversation={onNewConversation}
        disabled={isInputDisabled}
        value={inputValue}
        onChange={setInputValue}
      />
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';
