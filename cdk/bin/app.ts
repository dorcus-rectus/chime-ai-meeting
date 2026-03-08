#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { ChimeAiMeetingStack } from '../lib/chime-ai-meeting-stack';
import { CicdStack } from '../lib/cicd-stack';

const app = new cdk.App();

const stack = new ChimeAiMeetingStack(app, 'ChimeAiMeetingStack', {
  env: {
    region: 'ap-northeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'Amazon Chime SDK + Bedrock Claude による AI ビデオ会議システム',
});

// -------------------------------------------------------
// FinOps: コスト配分タグ — 全リソースへ一括伝播
// AWS Cost Explorer でプロジェクト単位のコストを可視化できる
// -------------------------------------------------------
Tags.of(app).add('Project', 'AI-Meeting-Assistant');
Tags.of(app).add('Environment', 'Production');
Tags.of(app).add('ManagedBy', 'CDK');

// -------------------------------------------------------
// cdk-nag: AWS Solutions セキュリティ/コンプライアンス自動監査
// synth / test 時に Well-Architected Framework の違反を検出する
// -------------------------------------------------------
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: false }));

// -------------------------------------------------------
// cdk-nag 抑制ルール
// アーキテクチャ上の制約により意図的に違反しているルールを明示
// -------------------------------------------------------
NagSuppressions.addStackSuppressions(stack, [
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'AWSLambdaBasicExecutionRole は Lambda 実行に必要な最小権限マネージドポリシー。' +
      '独自ポリシーへの置き換えより可読性・メンテナンス性を優先。',
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      '(1) Bedrock InvokeAgent / InvokeModel は実行時に ARN が確定しない動的リソースのため * が必要。' +
      '(2) Polly SynthesizeSpeech / Chime CreateMeeting はリソース ARN を指定できない API。' +
      '(3) S3 Vectors は GA 初期のため特定 ARN 指定が SDK 非対応。',
  },
  {
    id: 'AwsSolutions-L1',
    reason:
      'CDK 内部カスタムリソース Lambda (AwsCustomResource 等) は CDK 内部実装であり、' +
      'ランタイムバージョンをアプリコードで制御できない。',
  },
  {
    id: 'AwsSolutions-SQS3',
    reason:
      'Dead-Letter Queue (DLQ) 自体にはさらに DLQ を設定しない。' +
      '失敗メッセージは 14 日間保持して手動調査する運用フローを採用。',
  },
  {
    id: 'AwsSolutions-APIG2',
    reason:
      'API Gateway リクエストバリデーションは Cognito Authorizer と Lambda 内バリデーションで代替。',
  },
  {
    id: 'AwsSolutions-APIG4',
    reason:
      '全エンドポイントに Cognito Authorizer が設定されている (authMethodOptions)。' +
      'OPTIONS プリフライトのみ認証なし (CORS 要件)。',
  },
  {
    id: 'AwsSolutions-COG4',
    reason: '上記と同じく全 POST/GET/DELETE メソッドに Cognito Authorizer を適用済み。',
  },
  {
    id: 'AwsSolutions-COG3',
    reason:
      'Cognito AdvancedSecurityMode は追加料金が発生するため今回は無効。' +
      '本番環境では ENFORCED を推奨 (userPool に advancedSecurityMode を追加)。',
  },
  {
    id: 'AwsSolutions-COG7',
    reason:
      'MFA は今回のシステム要件に含まれないが、本番運用では有効化を推奨。' +
      '(Cognito の MFA 設定は userPool に mfa: cognito.Mfa.REQUIRED を追加することで対応可能)',
  },
  {
    id: 'AwsSolutions-COG2',
    reason:
      'MFA は今回のシステム要件に含まれない (COG7 と同様の理由)。' +
      '本番運用では MFA 有効化を推奨。',
  },
  {
    id: 'AwsSolutions-DDB3',
    reason:
      'Point-in-time Recovery は開発・検証環境では不要。' +
      '本番環境では pointInTimeRecovery: true の有効化を推奨。',
  },
  {
    id: 'AwsSolutions-APIG3',
    reason:
      'WAFv2 は小規模プロジェクトにおいてコストが見合わないと判断。' +
      '本番環境では API Gateway に WAFv2 WebACL の関連付けを推奨。',
  },
]);

// -------------------------------------------------------
// CI/CD スタック (CodeCommit + CodePipeline + CodeBuild)
// 初回・更新時のみ手動でデプロイ:
//   npx cdk deploy CicdStack
// -------------------------------------------------------
const cicdStack = new CicdStack(app, 'CicdStack', {
  env: {
    region: 'ap-northeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'CI/CD パイプライン (CodeCommit → CodePipeline → deploy.sh)',
});

NagSuppressions.addStackSuppressions(cicdStack, [
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'CodeBuild ロールは CDK デプロイを含む広範な権限が必要なため PowerUserAccess を使用。' +
      'CI/CD 専用ロールとして範囲を制限している。',
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'CodeBuild / CodePipeline の内部ロール (アーティファクトバケット・ログ・KMS) は ' +
      'CDK が自動生成するワイルドカードポリシーであり、実行時 ARN が確定しないため * が必要。' +
      'また CDK deploy には CloudFormation 経由でリソース ARN が不確定な権限が多数含まれる。',
  },
  {
    id: 'AwsSolutions-KMS5',
    reason:
      'CodePipeline アーティファクトバケットの KMS キーは CDK が自動生成するため、' +
      'ローテーション設定を直接制御できない。CI/CD 用途であり許容範囲と判断。',
  },
  {
    id: 'AwsSolutions-S1',
    reason:
      'CodePipeline アーティファクトバケットはビルド成果物の一時保管用。' +
      'アクセスログは CodeBuild ログで代替。',
  },
]);
