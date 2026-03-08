/**
 * Vitest グローバルセットアップ
 * jsdom 環境で利用できないブラウザ API をモックする
 */
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 各テスト後に DOM をクリーンアップ
afterEach(() => {
  cleanup();
});

// ── AudioContext モック ──────────────────────────────────────────────────────
// jsdom は AudioContext を実装しないため vi.fn() でスタブ化
const mockBufferSource = {
  buffer: null,
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  disconnect: vi.fn(),
  onended: null as (() => void) | null,
};

const mockAudioContext = {
  state: 'running' as AudioContextState,
  resume: vi.fn().mockResolvedValue(undefined),
  decodeAudioData: vi.fn().mockResolvedValue({ duration: 1 }),
  createBufferSource: vi.fn().mockReturnValue(mockBufferSource),
  destination: {},
};

Object.defineProperty(global, 'AudioContext', {
  value: vi.fn().mockImplementation(() => mockAudioContext),
  writable: true,
});

// webkitAudioContext (Safari 対応)
Object.defineProperty(global, 'webkitAudioContext', {
  value: vi.fn().mockImplementation(() => mockAudioContext),
  writable: true,
});

// ── HTMLMediaElement モック ───────────────────────────────────────────────────
// jsdom では <video>/<audio> の play/load が実装されていない
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  value: vi.fn().mockResolvedValue(undefined),
  writable: true,
});
Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  value: vi.fn(),
  writable: true,
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  value: vi.fn(),
  writable: true,
});

// ── SpeechRecognition モック ─────────────────────────────────────────────────
const mockRecognition = {
  continuous: false,
  interimResults: false,
  lang: '',
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onresult: null,
  onerror: null,
  onend: null,
};
Object.defineProperty(global, 'webkitSpeechRecognition', {
  value: vi.fn().mockImplementation(() => mockRecognition),
  writable: true,
});

// ── URL モック ───────────────────────────────────────────────────────────────
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
global.URL.revokeObjectURL = vi.fn();

// ── ResizeObserver モック ────────────────────────────────────────────────────
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
