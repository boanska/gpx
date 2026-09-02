import { createCanvas, Path2D } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

function renderIcon(size, isMaskable = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background Gradient
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#3b82f6');
  grad.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = grad;

  if (isMaskable) {
    ctx.fillRect(0, 0, size, size);
  } else {
    const radius = size * 0.2; // Smooth squircle corners
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.fill();
  }

  // Draw Route Icon
  // Original Lucide icon is in a 24x24 box:
  // <circle cx="6" cy="19" r="3" />
  // <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
  // <circle cx="18" cy="5" r="3" />

  ctx.save();
  // Safe zone scaling: slightly smaller for maskable to stay within safe circle when rotated
  const iconSize = size * (isMaskable ? 0.54 : 0.62);
  const scale = iconSize / 24;

  // Center, rotate by -12deg (matching background -rotate-12), and center the 24x24 path
  ctx.translate(size / 2, size / 2);
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Bottom-left circle
  ctx.beginPath();
  ctx.arc(6, 19, 3, 0, Math.PI * 2);
  ctx.stroke();

  // Route path
  const routePath = new Path2D('M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15');
  ctx.stroke(routePath);

  // Top-right circle
  ctx.beginPath();
  ctx.arc(18, 5, 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  return canvas.toBuffer('image/png');
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), renderIcon(512, false));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), renderIcon(512, true));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), renderIcon(192, false));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), renderIcon(180, false));
fs.writeFileSync(path.join(publicDir, 'favicon.png'), renderIcon(64, false));

console.log('Successfully generated all PWA icons!');
