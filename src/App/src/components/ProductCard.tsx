import React from 'react';
import { Text, tokens } from '@fluentui/react-components';
import { Box20Regular } from '@fluentui/react-icons';
import type { Product } from '../types';
import { PRODUCT_DEFAULTS } from '../utils/constants';

interface ProductCardProps {
  product: Product;
  /** Image/icon size in px */
  size?: 'small' | 'medium';
  /** Optional selection border */
  isSelected?: boolean;
  /** Card click handler (omit for read-only cards) */
  onClick?: () => void;
  disabled?: boolean;
}

const SIZE_MAP = {
  small: { img: 56, radius: '6px', textSize: 300 as const, priceSize: 200 as const },
  medium: { img: 80, radius: '8px', textSize: 400 as const, priceSize: 300 as const },
};

export const ProductCard = React.memo(function ProductCard({
  product,
  size = 'medium',
  isSelected = false,
  onClick,
  disabled = false,
}: ProductCardProps) {
  const { img, radius, textSize, priceSize } = SIZE_MAP[size];

  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: size === 'small' ? '12px' : '16px',
        padding: size === 'small' ? '12px' : '16px',
        borderRadius: '8px',
        border: isSelected
          ? `2px solid ${tokens.colorBrandStroke1}`
          : `1px ${onClick ? 'dashed' : 'solid'} ${tokens.colorNeutralStroke2}`,
        backgroundColor: isSelected
          ? tokens.colorBrandBackground2
          : tokens.colorNeutralBackground1,
        cursor: onClick ? (disabled ? 'not-allowed' : 'pointer') : 'default',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.15s ease-in-out',
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {/* Product image or fallback icon */}
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.product_name}
          style={{
            width: `${img}px`,
            height: `${img}px`,
            objectFit: 'cover',
            borderRadius: radius,
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: `${img}px`,
            height: `${img}px`,
            borderRadius: radius,
            backgroundColor: tokens.colorNeutralBackground3,
            border: `1px solid ${tokens.colorNeutralStroke2}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box20Regular style={{ color: tokens.colorNeutralForeground3, fontSize: '24px' }} />
        </div>
      )}

      {/* Product info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text
          weight="semibold"
          size={textSize}
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground1,
            marginBottom: size === 'small' ? '2px' : '4px',
          }}
        >
          {product.product_name}
        </Text>
        <Text
          size={200}
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: size === 'small' ? '2px' : '4px',
          }}
        >
          {product.tags || product.description || PRODUCT_DEFAULTS.fallbackTags}
        </Text>
        <Text
          weight="semibold"
          size={priceSize}
          style={{
            display: 'block',
            color: tokens.colorNeutralForeground1,
          }}
        >
          ${product.price?.toFixed(2) || PRODUCT_DEFAULTS.fallbackPrice.toFixed(2)} USD
        </Text>
      </div>
    </div>
  );
});

ProductCard.displayName = 'ProductCard';
