/**
 * TypingIndicator component - shows loading/thinking state
 * Extracted from ChatPanel.tsx and wrapped with React.memo
 */

import React from 'react';
import {
  Text,
  Button,
  Tooltip,
  tokens,
} from '@fluentui/react-components';
import { Stop24Regular } from '@fluentui/react-icons';

interface TypingIndicatorProps {
  generationStatus?: string;
  onStopGeneration?: () => void;
}

export const TypingIndicator = React.memo(function TypingIndicator({
  generationStatus,
  onStopGeneration,
}: TypingIndicatorProps) {
  return (
    <div className="typing-indicator" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: '8px',
      alignSelf: 'flex-start',
      width: '100%',
    }}>
      <div className="thinking-dots">
        <span style={{
          display: 'inline-flex',
          gap: '4px',
          alignItems: 'center',
        }}>
          <span className="dot" />
          <span className="dot" style={{ animationDelay: '0.2s' }} />
          <span className="dot" style={{ animationDelay: '0.4s' }} />
        </span>
      </div>
      <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
        {generationStatus || 'Thinking...'}
      </Text>
      {onStopGeneration && (
        <Tooltip content="Stop generation" relationship="label">
          <Button
            appearance="subtle"
            icon={<Stop24Regular />}
            onClick={onStopGeneration}
            size="small"
            style={{
              color: tokens.colorPaletteRedForeground1,
              minWidth: '32px',
              marginLeft: 'auto',
            }}
          >
            Stop
          </Button>
        </Tooltip>
      )}
    </div>
  );
});

TypingIndicator.displayName = 'TypingIndicator';
