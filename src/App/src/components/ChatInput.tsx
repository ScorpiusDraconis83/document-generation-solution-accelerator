/**
 * ChatInput component - message input with send/new-chat buttons
 * Extracted from ChatPanel.tsx and wrapped with React.memo
 */

import React, { useState } from 'react';
import {
  Text,
  Button,
  Tooltip,
  tokens,
} from '@fluentui/react-components';
import {
  Send20Regular,
  Add20Regular,
} from '@fluentui/react-icons';
import { AI_DISCLAIMER } from '../utils/constants';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  hasMessages: boolean;
  onNewConversation?: () => void;
  initialValue?: string;
  onInputChange?: (value: string) => void;
}

export const ChatInput = React.memo(function ChatInput({
  onSendMessage,
  isLoading,
  hasMessages,
  onNewConversation,
  initialValue = '',
  onInputChange,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState(initialValue);

  // Sync external value changes (e.g., from suggestion clicks)
  React.useEffect(() => {
    setInputValue(initialValue);
  }, [initialValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isLoading) {
      onSendMessage(inputValue.trim());
      setInputValue('');
      onInputChange?.('');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    onInputChange?.(e.target.value);
  };

  return (
    <div style={{
      margin: '0 8px 8px 8px',
      position: 'relative',
    }}>
      {/* Input Box */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: '4px',
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
      }}>
        <input
          type="text"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Type a message"
          disabled={isLoading}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            backgroundColor: 'transparent',
            fontFamily: 'var(--fontFamilyBase)',
            fontSize: '14px',
            color: tokens.colorNeutralForeground1,
          }}
        />

        {/* Icons on the right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0px' }}>
          <Tooltip content="New chat" relationship="label">
            <Button
              appearance="subtle"
              icon={<Add20Regular />}
              size="small"
              onClick={onNewConversation}
              disabled={isLoading || !hasMessages}
              style={{
                minWidth: '32px',
                height: '32px',
                color: tokens.colorNeutralForeground3,
              }}
            />
          </Tooltip>

          {/* Vertical divider */}
          <div style={{
            width: '1px',
            height: '20px',
            backgroundColor: tokens.colorNeutralStroke2,
            margin: '0 4px',
          }} />

          <Button
            appearance="subtle"
            icon={<Send20Regular />}
            size="small"
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isLoading}
            style={{
              minWidth: '32px',
              height: '32px',
              color: inputValue.trim() ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground4,
            }}
          />
        </div>
      </div>

      {/* Disclaimer */}
      <Text
        size={100}
        style={{
          display: 'block',
          marginTop: '8px',
          color: tokens.colorNeutralForeground4,
          fontSize: '12px',
        }}
      >
        {AI_DISCLAIMER}
      </Text>
    </div>
  );
});

ChatInput.displayName = 'ChatInput';
