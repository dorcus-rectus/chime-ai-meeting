import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
  StartMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const client = new ChimeSDKMeetingsClient({ region: process.env.REGION ?? 'ap-northeast-1' });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // 会議を作成
    const meetingResponse = await client.send(
      new CreateMeetingCommand({
        ClientRequestToken: crypto.randomUUID(),
        MediaRegion: 'ap-northeast-1',
        ExternalMeetingId: `meeting-${Date.now()}`,
        MeetingFeatures: {
          Audio: {
            EchoReduction: 'AVAILABLE',
          },
        },
      }),
    );

    const meetingId = meetingResponse.Meeting!.MeetingId!;

    // ユーザー参加者を作成
    const attendeeResponse = await client.send(
      new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: `user-${crypto.randomUUID()}`,
      }),
    );

    // 日本語書き起こしを開始
    // 注: Chime SDK 書き起こしサービスリンクロールが必要です
    try {
      await client.send(
        new StartMeetingTranscriptionCommand({
          MeetingId: meetingId,
          TranscriptionConfiguration: {
            EngineTranscribeSettings: {
              LanguageCode: 'ja-JP',
              EnablePartialResultsStabilization: true,
              PartialResultsStability: 'medium',
            },
          },
        }),
      );
      console.log('書き起こし開始:', meetingId);
    } catch (transcribeErr) {
      // 書き起こし開始失敗はログのみ（会議自体は継続）
      console.warn('書き起こし開始失敗 (会議は継続):', transcribeErr);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        meeting: meetingResponse.Meeting,
        attendee: attendeeResponse.Attendee,
      }),
    };
  } catch (error) {
    console.error('会議作成エラー:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: '会議の作成に失敗しました',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
