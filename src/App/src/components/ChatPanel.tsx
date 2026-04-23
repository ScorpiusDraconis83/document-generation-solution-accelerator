import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, CreativeBrief, Product, GeneratedContent } from '../types';
import { BriefReview } from './BriefReview';
import { ConfirmedBriefView } from './ConfirmedBriefView';
import { SelectedProductView } from './SelectedProductView';
import { ProductReview } from './ProductReview';
import { InlineContentPreview } from './InlineContentPreview';
import { WelcomeCard } from './WelcomeCard';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatInput } from './ChatInput';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  generationStatus?: string;
  onStopGeneration?: () => void;
  // Inline component props
  pendingBrief?: CreativeBrief | null;
  confirmedBrief?: CreativeBrief | null;
  generatedContent?: GeneratedContent | null;
  selectedProducts?: Product[];
  availableProducts?: Product[];
  onBriefConfirm?: () => void;
  onBriefCancel?: () => void;
  onGenerateContent?: () => void;
  onRegenerateContent?: () => void;
  onProductSelect?: (product: Product) => void;
  // Feature flags
  imageGenerationEnabled?: boolean;
  // New chat
  onNewConversation?: () => void;
}

export const ChatPanel = React.memo(function ChatPanel({ 
  messages, 
  onSendMessage, 
  isLoading,
  generationStatus,
  onStopGeneration,
  pendingBrief,
  confirmedBrief,
  generatedContent,
  selectedProducts = [],
  availableProducts = [],
  onBriefConfirm,
  onBriefCancel,
  onGenerateContent,
  onRegenerateContent,
  onProductSelect,
  imageGenerationEnabled = true,
  onNewConversation,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingBrief, confirmedBrief, generatedContent, isLoading, generationStatus]);

  // Determine if we should show inline components
  const showBriefReview = !!(pendingBrief && onBriefConfirm && onBriefCancel);
  const showProductReview = !!(confirmedBrief && !generatedContent && onGenerateContent);
  const showContentPreview = !!(generatedContent && onRegenerateContent);
  const showWelcome = messages.length === 0 && !showBriefReview && !showProductReview && !showContentPreview;

  // Handle suggestion click from welcome card
  const handleSuggestionClick = useCallback((prompt: string) => {
    setInputValue(prompt);
  }, []);

  const handleSendMessage = useCallback((msg: string) => {
    onSendMessage(msg);
    setInputValue('');
  }, [onSendMessage]);

  return (
    <div className="chat-container">
      {/* Messages Area */}
      <div 
        className="messages"
        ref={messagesContainerRef}
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
                generationStatus={generationStatus}
                onStopGeneration={onStopGeneration}
              />
            )}
          </>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <ChatInput
        initialValue={inputValue}
        onInputChange={setInputValue}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        hasMessages={messages.length > 0}
        onNewConversation={onNewConversation}
      />
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';


