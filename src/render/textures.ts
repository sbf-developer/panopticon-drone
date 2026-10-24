import * as THREE from 'three';
import { Rng } from '../core/math/random';

const makeTexture = (
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  srgb = true,
): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

const withAlpha = (hex: string, alpha: number): string => {
  const color = new THREE.Color(hex);
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
    color.b * 255,
  )}, ${alpha})`;
};

export const makeGroundTexture = (base: string, accent: string, seed: number, dirt = false): THREE.CanvasTexture => {
  const rng = new Rng(seed);
  return makeTexture(512, 512, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 512);
    if (dirt) {
      for (let i = 0; i < 5600; i += 1) {
        const x = rng.range(0, 512);
        const y = rng.range(0, 512);
        const r = rng.range(0.4, 2.6);
        ctx.fillStyle = withAlpha(rng.chance(0.55) ? accent : '#d6c49d', rng.range(0.05, 0.25));
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.55, rng.range(0, Math.PI), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 30; i += 1) {
        const x = rng.range(0, 512);
        const y = rng.range(0, 512);
        const r = rng.range(16, 70);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, withAlpha(accent, 0.12));
        gradient.addColorStop(1, withAlpha(accent, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } else {
      for (let i = 0; i < 4300; i += 1) {
        const x = rng.range(0, 512);
        const y = rng.range(0, 512);
        const length = rng.range(1, 4.4);
        ctx.strokeStyle = withAlpha(rng.chance(0.6) ? accent : '#c7d09c', rng.range(0.04, 0.16));
        ctx.lineWidth = rng.range(0.5, 1.4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rng.range(-1, 1), y - length);
        ctx.stroke();
      }
      for (let i = 0; i < 26; i += 1) {
        const x = rng.range(0, 512);
        const y = rng.range(0, 512);
        const r = rng.range(20, 90);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, withAlpha(rng.chance(0.4) ? accent : '#8f9c6b', 0.1));
        gradient.addColorStop(1, withAlpha(accent, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  });
};

export const makeRoadTexture = (base: string, accent: string, seed: number, dirt: boolean): THREE.CanvasTexture => {
  const rng = new Rng(seed);
  return makeTexture(256, 256, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    if (dirt) {
      for (let i = 0; i < 2200; i += 1) {
        ctx.fillStyle = withAlpha(rng.chance(0.5) ? accent : '#d8c8a8', rng.range(0.05, 0.25));
        const x = rng.range(0, 256);
        const y = rng.range(0, 256);
        ctx.fillRect(x, y, rng.range(0.5, 2.5), rng.range(0.5, 2.5));
      }
      for (let i = 0; i < 7; i += 1) {
        ctx.strokeStyle = withAlpha('#3e3728', 0.12);
        ctx.lineWidth = rng.range(4, 10);
        ctx.beginPath();
        ctx.moveTo(rng.range(0, 256), 0);
        ctx.bezierCurveTo(rng.range(0, 256), 80, rng.range(0, 256), 170, rng.range(0, 256), 256);
        ctx.stroke();
      }
    } else {
      for (let i = 0; i < 4000; i += 1) {
        const shade = rng.range(0.05, 0.22);
        ctx.fillStyle = rng.chance(0.5) ? `rgba(255,255,255,${shade * 0.25})` : `rgba(0,0,0,${shade})`;
        ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(0.4, 1.7), rng.range(0.4, 1.7));
      }
      ctx.strokeStyle = withAlpha(accent, 0.1);
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        ctx.moveTo(rng.range(0, 256), 0);
        ctx.lineTo(rng.range(0, 256), 256);
        ctx.stroke();
      }
    }
  });
};

export type FacadeKind = 'office' | 'warehouse' | 'wood' | 'barn' | 'metal';

export const makeFacadeTexture = (
  kind: FacadeKind,
  tint: number,
  windowGlow: string,
  seed: number,
): THREE.CanvasTexture => {
  const rng = new Rng(seed);
  const base = `#${new THREE.Color(tint).getHexString()}`;
  return makeTexture(256, 256, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);

    if (kind === 'office') {
      ctx.fillStyle = withAlpha('#0c141a', 0.18);
      ctx.fillRect(0, 0, 256, 14);
      const cols = 6;
      const rows = 7;
      const cellW = 256 / cols;
      const cellH = 256 / rows;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = col * cellW + 4;
          const y = row * cellH + 7;
          const lit = rng.chance(0.11);
          const gradient = ctx.createLinearGradient(x, y, x + cellW - 8, y + cellH - 14);
          gradient.addColorStop(0, lit ? windowGlow : '#263c4b');
          gradient.addColorStop(0.55, lit ? '#f2c984' : '#162a37');
          gradient.addColorStop(1, lit ? '#caa166' : '#0d1a23');
          ctx.fillStyle = gradient;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(x, y, cellW - 8, cellH - 14);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(10,18,24,0.45)';
          ctx.strokeRect(x, y, cellW - 8, cellH - 14);
        }
      }
      ctx.strokeStyle = withAlpha('#e8e3d2', 0.11);
      ctx.lineWidth = 2;
      for (let row = 1; row < rows; row += 1) {
        ctx.beginPath();
        ctx.moveTo(0, row * cellH);
        ctx.lineTo(256, row * cellH);
        ctx.stroke();
      }
    } else if (kind === 'warehouse') {
      ctx.strokeStyle = withAlpha('#222b31', 0.32);
      ctx.lineWidth = 1;
      for (let x = 0; x < 256; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,30,38,0.7)';
      ctx.fillRect(26, 154, 78, 102);
      ctx.fillRect(150, 154, 80, 102);
      ctx.fillStyle = withAlpha('#f0b05a', 0.4);
      ctx.fillRect(34, 167, 62, 8);
      ctx.fillRect(158, 167, 64, 8);
      for (let row = 0; row < 3; row += 1) {
        ctx.fillStyle = 'rgba(30,48,58,0.8)';
        ctx.fillRect(102, 28 + row * 24, 52, 12);
      }
    } else if (kind === 'wood') {
      for (let y = 0; y < 256; y += 10) {
        ctx.fillStyle = withAlpha(y % 20 === 0 ? '#6b5540' : '#3f3023', 0.14);
        ctx.fillRect(0, y, 256, 9);
      }
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          ctx.fillStyle = 'rgba(24,38,44,0.86)';
          ctx.fillRect(26 + col * 76, 36 + row * 76, 44, 42);
          ctx.fillStyle = withAlpha('#f0d39b', 0.25);
          ctx.fillRect(26 + col * 76, 36 + row * 76, 44, 5);
        }
      }
    } else if (kind === 'barn') {
      ctx.strokeStyle = 'rgba(40,22,16,0.25)';
      for (let x = 0; x < 256; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(44,26,18,0.9)';
      ctx.fillRect(70, 120, 116, 136);
      ctx.strokeStyle = withAlpha('#e5d7bd', 0.45);
      ctx.lineWidth = 4;
      ctx.strokeRect(78, 128, 100, 120);
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128, 248);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(230,236,235,0.15)';
      for (let y = 0; y < 256; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,30,36,0.35)';
      ctx.fillRect(0, 210, 256, 46);
      for (let x = 0; x < 256; x += 32) {
        ctx.fillStyle = 'rgba(240,240,230,0.08)';
        ctx.fillRect(x, 0, 2, 256);
      }
    }

    // Grime and weathering.
    for (let i = 0; i < 700; i += 1) {
      ctx.fillStyle = `rgba(15,20,24,${rng.range(0.01, 0.08)})`;
      ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(0.5, 2.2), rng.range(1, 8));
    }
  });
};

export const makeCloudTexture = (seed: number): THREE.CanvasTexture => {
  const rng = new Rng(seed);
  return makeTexture(256, 128, (ctx) => {
    ctx.clearRect(0, 0, 256, 128);
    for (let i = 0; i < 26; i += 1) {
      const x = 128 + rng.range(-88, 88);
      const y = 66 + rng.range(-28, 26);
      const r = rng.range(18, 54);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, 'rgba(255,255,255,0.32)');
      gradient.addColorStop(0.55, 'rgba(238,243,246,0.16)');
      gradient.addColorStop(1, 'rgba(238,243,246,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, false);
};

export const makeHelipadTexture = (): THREE.CanvasTexture =>
  makeTexture(512, 512, (ctx) => {
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = '#2d3132';
    ctx.beginPath();
    ctx.arc(256, 256, 248, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d9d4c6';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(256, 256, 220, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#e6a23c';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(256, 256, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8e4d8';
    ctx.font = 'bold 190px "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', 256, 270);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.save();
      ctx.translate(256 + Math.cos(angle) * 202, 256 + Math.sin(angle) * 202);
      ctx.rotate(angle);
      ctx.fillStyle = '#e6a23c';
      ctx.fillRect(-3, -13, 6, 26);
      ctx.restore();
    }
  });

export const makeLabelTexture = (title: string, subtitle: string, color = '#f2a65a'): THREE.CanvasTexture =>
  makeTexture(512, 128, (ctx) => {
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(8, 12, 16, 0.72)';
    ctx.fillRect(4, 18, 504, 92);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 18, 504, 92);
    ctx.fillStyle = color;
    ctx.font = '600 31px "Space Grotesk", sans-serif';
    ctx.fillText(title, 24, 56);
    ctx.fillStyle = '#c8d4da';
    ctx.font = '500 21px "JetBrains Mono", monospace';
    ctx.fillText(subtitle, 24, 88);
  });
