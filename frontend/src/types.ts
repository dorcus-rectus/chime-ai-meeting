export interface MeetingResponse {
  meeting: ChimeMeeting;
  attendee: ChimeAttendee;
}

export interface ChimeMeeting {
  MeetingId: string;
  ExternalMeetingId: string;
  MediaRegion: string;
  MediaPlacement: {
    AudioHostUrl: string;
    AudioFallbackUrl: string;
    ScreenDataUrl: string;
    ScreenSharingUrl: string;
    ScreenViewingUrl: string;
    SignalingUrl: string;
    TurnControlUrl: string;
    EventIngestionUrl?: string;
  };
}

export interface ChimeAttendee {
  AttendeeId: string;
  ExternalUserId: string;
  JoinToken: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  hasFrame?: boolean; // 画面共有フレームを添付して送信したメッセージ
}

export interface AIChatResponse {
  text: string;
  audio: string; // Base64 エンコード MP3
  ragUsed: boolean;
  visionError?: string; // Vision (Converse API) 失敗時のエラー詳細
}

/** チャット入力時の添付ファイル */
export type FileAttachment =
  | { type: 'image'; base64: string; mimeType: string; name: string }
  | { type: 'text'; content: string; name: string };

export const RESOLUTIONS = [
  { label: '640×480 (SD)', width: 640, height: 480 },
  { label: '1280×720 (HD)', width: 1280, height: 720 },
  { label: '1920×1080 (Full HD)', width: 1920, height: 1080 },
] as const;
