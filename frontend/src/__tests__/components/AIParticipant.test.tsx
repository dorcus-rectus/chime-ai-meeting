import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AIParticipant } from '../../components/AIParticipant';

describe('AIParticipant', () => {
  const defaultProps = { isSpeaking: false, isProcessing: false, aiText: '' };

  it('アイドル状態で「待機中」を表示する', () => {
    render(<AIParticipant {...defaultProps} />);
    expect(screen.getByText('待機中')).toBeInTheDocument();
    expect(screen.getByText('AI アシスタント')).toBeInTheDocument();
  });

  it('isSpeaking=true のとき「応答中」を表示する', () => {
    render(<AIParticipant {...defaultProps} isSpeaking={true} />);
    expect(screen.getByText('応答中')).toBeInTheDocument();
  });

  it('isProcessing=true のとき「解析中...」を表示する', () => {
    render(<AIParticipant {...defaultProps} isProcessing={true} />);
    expect(screen.getByText('解析中...')).toBeInTheDocument();
  });

  it('aiText が渡されたとき発言テキストを表示する', () => {
    const text = 'こんにちは、何かお手伝いできますか？';
    render(<AIParticipant {...defaultProps} aiText={text} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('aiText が空のとき発言テキストを表示しない', () => {
    const { container } = render(<AIParticipant {...defaultProps} aiText="" />);
    // aiText が空のときはテキスト表示用 div が存在しない
    const textBubble = container.querySelector('[style*="rgba(0,0,0,0.72)"]');
    expect(textBubble).toBeNull();
  });

  it('aibot.mp4 の <video> 要素をレンダリングする', () => {
    const { container } = render(<AIParticipant {...defaultProps} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video?.getAttribute('src')).toBe('/aibot.mp4');
    // jsdom reflects boolean props as properties, not always as HTML attributes
    expect((video as HTMLVideoElement)?.loop).toBe(true);
    expect((video as HTMLVideoElement)?.muted).toBe(true);
  });

  it('isProcessing=true のときスキャンライン要素をレンダリングする', () => {
    const { container } = render(<AIParticipant {...defaultProps} isProcessing={true} />);
    // スキャンライン: animation: 'scan ...' が付いた div
    const scanLine = container.querySelector('[style*="scan"]');
    expect(scanLine).toBeInTheDocument();
  });

  it('isProcessing=false のときスキャンラインが存在しない', () => {
    const { container } = render(<AIParticipant {...defaultProps} isProcessing={false} />);
    const scanLine = container.querySelector('[style*="scan"]');
    expect(scanLine).toBeNull();
  });
});
