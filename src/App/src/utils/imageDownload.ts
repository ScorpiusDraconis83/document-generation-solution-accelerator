/**
 * Download an image with a branded banner overlay.
 * Falls back to a plain download if canvas rendering fails.
 */
export function downloadImageWithBanner(
  imageUrl: string,
  headline: string,
  tagline?: string,
): void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    triggerDownload(imageUrl);
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    const bannerHeight = Math.max(60, img.height * 0.1);
    const padding = Math.max(16, img.width * 0.03);

    canvas.width = img.width;
    canvas.height = img.height + bannerHeight;

    // Draw image
    ctx.drawImage(img, 0, 0);

    // Draw white banner
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, img.height, img.width, bannerHeight);

    // Banner border
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, img.height);
    ctx.lineTo(img.width, img.height);
    ctx.stroke();

    // Headline
    const headlineFontSize = Math.max(18, Math.min(36, img.width * 0.04));
    ctx.font = `600 ${headlineFontSize}px Georgia, serif`;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(headline, padding, img.height + padding + headlineFontSize * 0.8, img.width - padding * 2);

    // Tagline
    if (tagline) {
      const taglineFontSize = Math.max(12, Math.min(20, img.width * 0.025));
      ctx.font = `400 italic ${taglineFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      ctx.fillStyle = '#666666';
      ctx.fillText(tagline, padding, img.height + padding + headlineFontSize + taglineFontSize * 0.8 + 4, img.width - padding * 2);
    }

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        triggerDownload(url, 'generated-marketing-image.png');
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  };

  img.onerror = () => triggerDownload(imageUrl);
  img.src = imageUrl;
}

function triggerDownload(url: string, filename = 'generated-image.png'): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}
