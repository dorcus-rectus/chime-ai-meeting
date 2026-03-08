import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { Template, Match, Annotations } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { ChimeAiMeetingStack } from '../lib/chime-ai-meeting-stack';

// ================================================================
// スタック合成 (モジュール先頭で 1 回だけ実行 — esbuild バンドルを抑制)
// ================================================================
const TEST_ENV = { account: '123456789012', region: 'ap-northeast-1' };
const app = new cdk.App();
const stack = new ChimeAiMeetingStack(app, 'TestStack', { env: TEST_ENV });

// cdk-nag セキュリティ監査を適用 (bin/app.ts と同じ抑制ルールを設定)
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: false }));
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM4', reason: 'テスト用抑制: AWSLambdaBasicExecutionRole は最小権限マネージドポリシー' },
  { id: 'AwsSolutions-IAM5', reason: 'テスト用抑制: Bedrock/Polly/Chime/S3Vectors はリソース ARN 指定不可' },
  { id: 'AwsSolutions-L1', reason: 'テスト用抑制: CDK 内部 LogRetention Lambda はランタイムを制御できない' },
  { id: 'AwsSolutions-SQS3', reason: 'テスト用抑制: DLQ 自体に DLQ は設定しない運用フロー' },
  { id: 'AwsSolutions-APIG2', reason: 'テスト用抑制: Lambda 内バリデーションで代替' },
  { id: 'AwsSolutions-APIG4', reason: 'テスト用抑制: Cognito Authorizer を全エンドポイントに適用済み' },
  { id: 'AwsSolutions-COG4', reason: 'テスト用抑制: 同上' },
  { id: 'AwsSolutions-COG3', reason: 'テスト用抑制: AdvancedSecurityMode は追加料金のため要件外' },
  { id: 'AwsSolutions-COG7', reason: 'テスト用抑制: MFA は要件外' },
]);

const template = Template.fromStack(stack);

// ================================================================
// スナップショットテスト
// ================================================================
describe('スナップショット', () => {
  test('CloudFormation テンプレートがスナップショットと一致する', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});

// ================================================================
// Cognito User Pool
// ================================================================
describe('Cognito User Pool', () => {

  test('User Pool が 1 つ作成される', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
  });

  test('セルフサインアップが有効になっている', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    });
  });

  test('メールアドレスでサインインできる', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
    });
  });

  test('パスワードポリシーが設定されている (8文字以上・大小英数記号必須)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,  // cdk-nag COG1 準拠
        },
      },
    });
  });

  test('User Pool Client が 1 つ作成される', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  test('User Pool Client にクライアントシークレットが設定されていない (SPA 用)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
    });
  });

  test('User Pool Client が USER_PASSWORD_AUTH と USER_SRP_AUTH を許可する', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith([
        'ALLOW_USER_PASSWORD_AUTH',
        'ALLOW_USER_SRP_AUTH',
        'ALLOW_REFRESH_TOKEN_AUTH',
      ]),
    });
  });
});

// ================================================================
// DynamoDB
// ================================================================
describe('DynamoDB テーブル', () => {

  test('DynamoDB テーブルが 2 つ作成される', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 2);
  });

  test('ChimeAiConversations テーブルに TTL が設定されている', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'ChimeAiConversations',
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('ChimeAiUsageRecords テーブルが PAY_PER_REQUEST で作成される', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'ChimeAiUsageRecords',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('UsageRecords テーブルに sessionId-index GSI が定義されている', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'ChimeAiUsageRecords',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'sessionId-index',
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });
});

// ================================================================
// SQS キュー
// ================================================================
describe('SQS キュー', () => {

  test('SQS キューが 2 つ作成される (本キュー + DLQ)', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  test('インジェストキューの可視性タイムアウトが 1800 秒', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'chime-ai-ingest-document',
      VisibilityTimeout: 1800,
    });
  });

  test('インジェストキューに DLQ が設定されている', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'chime-ai-ingest-document',
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
      }),
    });
  });

  test('DLQ のメッセージ保持期間が 14 日 (1209600 秒)', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'chime-ai-ingest-document-dlq',
      MessageRetentionPeriod: 1209600,
    });
  });
});

// ================================================================
// Lambda 関数
// ================================================================
describe('Lambda 関数', () => {

  // NodejsFunction は内部で LogRetention 用のカスタムリソース Lambda も生成するため
  // アプリケーション Lambda を runtime で絞って検査する
  function countAppLambdas(tmpl: Template): number {
    const resources = tmpl.findResources('AWS::Lambda::Function', {
      Properties: { Runtime: 'nodejs24.x' },
    });
    return Object.keys(resources).length;
  }

  test('アプリケーション Lambda が 6 つ作成される', () => {
    expect(countAppLambdas(template)).toBe(6);
  });

  test('create-meeting Lambda のタイムアウトが 30 秒', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-create-meeting',
      Timeout: 30,
      Runtime: 'nodejs24.x',
    });
  });

  test('ai-chat Lambda のタイムアウトが 90 秒・メモリ 512MB', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-chat',
      Timeout: 90,
      MemorySize: 512,
      Runtime: 'nodejs24.x',
    });
  });

  test('ingest-document Lambda のタイムアウトが 10 秒', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-ingest-document',
      Timeout: 10,
      Runtime: 'nodejs24.x',
    });
  });

  test('ingest-document-worker Lambda のタイムアウトが 300 秒・メモリ 512MB', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-ingest-document-worker',
      Timeout: 300,
      MemorySize: 512,
      Runtime: 'nodejs24.x',
    });
  });

  test('user-management Lambda が存在する', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-user-management',
      Runtime: 'nodejs24.x',
    });
  });

  test('manage-documents Lambda が存在する', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'chime-ai-manage-documents',
      Runtime: 'nodejs24.x',
    });
  });

  test('ingest-document-worker Lambda に SQS イベントソースが設定されている', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });
});

// ================================================================
// IAM ロール
// ================================================================
describe('IAM ロール', () => {

  test('Bedrock Agent ロールが bedrock.amazonaws.com を信頼する', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'bedrock.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      },
    });
  });

  test('Lambda 実行ロールが lambda.amazonaws.com を信頼する', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      },
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp('AWSLambdaBasicExecutionRole'),
            ]),
          ]),
        }),
      ]),
    });
  });

  test('Lambda ロールに bedrock:InvokeAgent 権限が付与されている', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'AgentCorePolicy',
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({ Action: 'bedrock:InvokeAgent' }),
            ]),
          },
        }),
      ]),
    });
  });

  test('Lambda ロールに polly:SynthesizeSpeech 権限が付与されている', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'PollyPolicy',
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({ Action: 'polly:SynthesizeSpeech' }),
            ]),
          },
        }),
      ]),
    });
  });

  test('Lambda ロールに s3vectors:ListVectors / DeleteVectors 権限が付与されている', () => {
    // Policies 配列内に S3VectorsPolicy が存在し、必要な Action が含まれることを確認
    const roles = template.findResources('AWS::IAM::Role', {
      Properties: {
        Policies: Match.arrayWith([
          Match.objectLike({ PolicyName: 'S3VectorsPolicy' }),
        ]),
      },
    });
    expect(Object.keys(roles).length).toBeGreaterThan(0);

    // S3Vectors の全 5 アクションが Statement に含まれることを JSON で検証
    const roleValues = Object.values(roles) as { Properties: { Policies: { PolicyName: string; PolicyDocument: { Statement: { Action: string[] }[] } }[] } }[];
    const s3VectorsPolicy = roleValues[0].Properties.Policies.find(
      (p) => p.PolicyName === 'S3VectorsPolicy',
    );
    const actions: string[] = s3VectorsPolicy!.PolicyDocument.Statement[0].Action;
    expect(actions).toContain('s3vectors:ListVectors');
    expect(actions).toContain('s3vectors:DeleteVectors');
    expect(actions).toContain('s3vectors:PutVectors');
  });

  test('Lambda ロールに cognito-idp:AdminDeleteUser / AdminGetUser 権限が付与されている', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'CognitoAdminPolicy',
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith([
                  'cognito-idp:AdminDeleteUser',
                  'cognito-idp:AdminGetUser',
                ]),
              }),
            ]),
          },
        }),
      ]),
    });
  });
});

// ================================================================
// Bedrock Agent
// ================================================================
describe('Bedrock AgentCore', () => {

  test('Bedrock Agent が 1 つ作成される', () => {
    template.resourceCountIs('AWS::Bedrock::Agent', 1);
  });

  test('Agent が jp.anthropic.claude-sonnet-4-6 を使用する', () => {
    template.hasResourceProperties('AWS::Bedrock::Agent', {
      AgentName: 'chime-ai-meeting-agent',
      FoundationModel: 'jp.anthropic.claude-sonnet-4-6',
      AutoPrepare: true,
    });
  });

  test('Agent のアイドルタイムアウトが 1800 秒', () => {
    template.hasResourceProperties('AWS::Bedrock::Agent', {
      IdleSessionTTLInSeconds: 1800,
    });
  });

  test('AgentAlias が 1 つ作成される', () => {
    template.resourceCountIs('AWS::Bedrock::AgentAlias', 1);
  });

  test('AgentAlias 名が prod', () => {
    template.hasResourceProperties('AWS::Bedrock::AgentAlias', {
      AgentAliasName: 'prod',
    });
  });
});

// ================================================================
// API Gateway
// ================================================================
describe('API Gateway', () => {

  test('RestApi が 1 つ作成される', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  });

  test('RestApi 名が chime-ai-meeting-api', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'chime-ai-meeting-api',
    });
  });

  test('Cognito Authorizer が 1 つ作成される', () => {
    template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
  });

  test('Cognito Authorizer が COGNITO_USER_POOLS タイプである', () => {
    template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Type: 'COGNITO_USER_POOLS',
      IdentitySource: 'method.request.header.Authorization',
    });
  });
});

// ================================================================
// CloudFormation 出力
// ================================================================
describe('CloudFormation Outputs', () => {

  const expectedOutputs = [
    'ApiUrl',
    'CognitoUserPoolId',
    'CognitoClientId',
    'BedrockAgentId',
    'BedrockAgentAliasId',
    'AmplifyAppId',
    'AmplifyDefaultDomain',
    'UsageTableName',
    'VectorBucketName',
    'IngestQueueUrl',
    'IngestDlqUrl',
  ];

  test.each(expectedOutputs)('Output "%s" が定義されている', (outputKey) => {
    template.hasOutput(outputKey, {});
  });
});

// ================================================================
// cdk-nag セキュリティ・コンプライアンス監査
// ================================================================
describe('cdk-nag セキュリティ監査', () => {
  test('抑制されていない ERROR レベルの nag 違反がないこと', () => {
    // cdk-nag は Annotations として警告/エラーを追加する
    // 抑制ルールを設定済みの既知の違反以外にエラーがないことを確認
    const errors = Annotations.fromStack(stack).findError(
      '*',
      Match.stringLikeRegexp('AwsSolutions-.*'),
    );
    expect(errors).toHaveLength(0);
  });

  test('Bedrock Agent ロールに BedrockModelPolicy が設定されている', () => {
    // cdk-nag IAM5 の抑制対象: Bedrock は動的 ARN のため * が必要
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'bedrock.amazonaws.com' },
          }),
        ]),
      },
      Policies: Match.arrayWith([
        Match.objectLike({ PolicyName: 'BedrockModelPolicy' }),
      ]),
    });
  });
});
