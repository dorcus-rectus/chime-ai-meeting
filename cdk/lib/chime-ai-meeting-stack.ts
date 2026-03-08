import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';
import { aws_amplify as amplify } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

export class ChimeAiMeetingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------
    // Chime 書き起こし用サービスリンクロール
    // -------------------------------------------------------
    new cr.AwsCustomResource(this, 'ChimeTranscriptionSLR', {
      onCreate: {
        service: 'IAM',
        action: 'createServiceLinkedRole',
        parameters: { AWSServiceName: 'transcription.chime.amazonaws.com' },
        physicalResourceId: cr.PhysicalResourceId.of('ChimeTranscriptionServiceLinkedRole'),
        ignoreErrorCodesMatching: 'InvalidInput',
      },
      // IAM は Lambda 組み込み SDK に含まれるため最新版インストール不要
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['iam:CreateServiceLinkedRole'],
          resources: [
            `arn:aws:iam::${this.account}:role/aws-service-role/transcription.chime.amazonaws.com/*`,
          ],
        }),
      ]),
    });

    // -------------------------------------------------------
    // Amazon Cognito — ユーザー認証
    // -------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'chime-ai-meeting-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,  // cdk-nag AwsSolutions-COG1 準拠
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: 'chime-ai-meeting-web',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    // -------------------------------------------------------
    // DynamoDB — 利用記録テーブル
    // (会話履歴は AgentCore が管理するため ConversationTable は参照用に保持)
    // -------------------------------------------------------
    // RemovalPolicy.DESTROY: スタック削除時にテーブルも削除する。
    // RETAIN にするとスタックのロールバック後に再デプロイする際
    // "Resource already exists" エラーが発生するため DESTROY を採用。
    const conversationTable = new dynamodb.Table(this, 'ConversationTable', {
      tableName: 'ChimeAiConversations',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const usageTable = new dynamodb.Table(this, 'UsageTable', {
      tableName: 'ChimeAiUsageRecords',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    usageTable.addGlobalSecondaryIndex({
      indexName: 'sessionId-index',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -------------------------------------------------------
    // SQS — ドキュメント取り込み非同期キュー
    //
    // API Gateway は 29 秒タイムアウトのため、大きなドキュメントの
    // 埋め込み生成 (チャンク × ~1s) は同期処理できない。
    // SQS + Worker Lambda で非同期処理し、タイムアウトを回避する。
    // -------------------------------------------------------
    const ingestDlq = new sqs.Queue(this, 'IngestDocumentDlq', {
      queueName: 'chime-ai-ingest-document-dlq',
      retentionPeriod: cdk.Duration.days(14), // 失敗メッセージを 2 週間保持
      enforceSSL: true, // cdk-nag AwsSolutions-SQS4: HTTPS 通信のみ許可
    });

    const ingestQueue = new sqs.Queue(this, 'IngestDocumentQueue', {
      queueName: 'chime-ai-ingest-document',
      // Worker Lambda のタイムアウト (300s) × 6 = 1800s
      visibilityTimeout: cdk.Duration.seconds(1800),
      enforceSSL: true, // cdk-nag AwsSolutions-SQS4: HTTPS 通信のみ許可
      deadLetterQueue: {
        queue: ingestDlq,
        maxReceiveCount: 3, // 3 回失敗後 DLQ へ
      },
    });

    // -------------------------------------------------------
    // S3 Vectors — RAG 用ベクトルインデックス
    // -------------------------------------------------------
    const vectorBucketName = `chime-ai-vectors-${this.account}`;
    const vectorIndexName = 'documents';

    // S3Vectors は SDK v3 専用サービス。AwsCustomResource の parameters も
    // SDK v3 の camelCase に合わせる必要がある。
    new cr.AwsCustomResource(this, 'S3VectorBucket', {
      onCreate: {
        service: 'S3Vectors',
        action: 'CreateVectorBucket',
        parameters: { vectorBucketName: vectorBucketName },
        physicalResourceId: cr.PhysicalResourceId.of(vectorBucketName),
        ignoreErrorCodesMatching: 'BucketAlreadyExists',
      },
      onDelete: {
        service: 'S3Vectors',
        action: 'DeleteVectorBucket',
        parameters: { vectorBucketName: vectorBucketName },
      },
      // S3Vectors は新しい API のため Lambda 組み込み SDK に含まれない可能性があり最新版が必要
      installLatestAwsSdk: true,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3vectors:CreateVectorBucket', 's3vectors:DeleteVectorBucket'],
          resources: ['*'],
        }),
      ]),
    });

    new cr.AwsCustomResource(this, 'S3VectorIndex', {
      onCreate: {
        service: 'S3Vectors',
        action: 'CreateIndex',
        parameters: {
          vectorBucketName: vectorBucketName,
          indexName: vectorIndexName,
          dataType: 'float32',
          dimension: 1024,
          distanceMetric: 'cosine',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${vectorBucketName}/${vectorIndexName}`),
        ignoreErrorCodesMatching: 'IndexAlreadyExists',
      },
      onDelete: {
        service: 'S3Vectors',
        action: 'DeleteIndex',
        parameters: { vectorBucketName: vectorBucketName, indexName: vectorIndexName },
      },
      // S3Vectors は新しい API のため Lambda 組み込み SDK に含まれない可能性があり最新版が必要
      installLatestAwsSdk: true,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3vectors:CreateIndex', 's3vectors:DeleteIndex'],
          resources: ['*'],
        }),
      ]),
    });

    // -------------------------------------------------------
    // Bedrock AgentCore — エージェント用 IAM ロール
    //
    // このロールは Lambda ではなく Bedrock サービスが引き受ける。
    // エージェントが Claude モデルを呼び出すための権限を付与する。
    // -------------------------------------------------------
    const agentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock:ap-northeast-1:${this.account}:agent/*`,
          },
        },
      }),
      inlinePolicies: {
        BedrockModelPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              // Bedrock Agents がクロスリージョン推論プロファイル経由でモデルを呼ぶ際、
              // 特定リソース ARN だと "Access denied when calling Bedrock" になるため * を使用。
              // (実測: 特定 ARN では httpStatusCode=200 でもストリーム内でエラーが返る)
              actions: ['bedrock:*'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              // jp.* クロスリージョン推論プロファイル利用時、Bedrock サービスが
              // ロールレベルでマーケットプレイス購読を確認するため必要
              actions: [
                'aws-marketplace:ViewSubscriptions',
                'aws-marketplace:Subscribe',
                'aws-marketplace:Unsubscribe',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // -------------------------------------------------------
    // Bedrock AgentCore — エージェント本体
    //
    // AgentCore はセッション ID で会話履歴を自動管理する。
    // Lambda が DynamoDB で会話履歴を管理していた処理が不要になり、
    // よりシンプルなコードでマルチターン会話を実現できる。
    // -------------------------------------------------------
    const agent = new bedrock.CfnAgent(this, 'AiMeetingAgent', {
      agentName: 'chime-ai-meeting-agent',
      agentResourceRoleArn: agentRole.roleArn,
      foundationModel: 'jp.anthropic.claude-sonnet-4-6',
      instruction:
        'あなたはビデオ会議に参加しているフレンドリーなAIアシスタントです。' +
        'ユーザーと日本語で自然な会話をしてください。' +
        '返答は簡潔に2〜3文程度にまとめ、話し言葉で答えてください。' +
        '会議の文脈を活かして、相手の発言に対して適切に反応してください。' +
        '参考情報が提供された場合は、その内容を踏まえて回答してください。',
      idleSessionTtlInSeconds: 1800, // 30分間のアイドルでセッション終了
      autoPrepare: true,             // デプロイ時に自動的に PREPARED 状態へ遷移
    });

    // エージェントエイリアス (本番用)
    // Lambda は エージェント ID + エイリアス ID で呼び出す
    const agentAlias = new bedrock.CfnAgentAlias(this, 'AiMeetingAgentAlias', {
      agentId: agent.attrAgentId,
      agentAliasName: 'prod',
    });
    agentAlias.addDependency(agent);

    // -------------------------------------------------------
    // Lambda 実行ロール (全関数共通)
    // -------------------------------------------------------
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        ChimePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              // @aws-sdk/client-chime-sdk-meetings は実際には chime: IAM プレフィックスを
              // 使用する。CloudWatch ログのエラー "not authorized to perform: chime:CreateMeeting"
              // で確認済み。chime-sdk-meetings: では AccessDenied になる。
              actions: [
                'chime:CreateMeeting',
                'chime:DeleteMeeting',
                'chime:GetMeeting',
                'chime:CreateAttendee',
                'chime:DeleteAttendee',
                'chime:GetAttendee',
                'chime:StartMeetingTranscription',
                'chime:StopMeetingTranscription',
              ],
              resources: ['*'],
            }),
          ],
        }),
        // AgentCore Runtime 呼び出し権限 (対象エイリアスのみに限定)
        AgentCorePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeAgent'],
              resources: [agentAlias.attrAgentAliasArn],
            }),
          ],
        }),
        // Titan Embeddings (RAG ベクトル化) 権限
        BedrockEmbeddingPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-text-v2:0`,
              ],
            }),
          ],
        }),
        // Converse API (Vision): 画面フレーム解析に使用
        // InvokeAgent の sessionState.files は JPEG 非対応のため Converse API で直接解析する
        BedrockVisionPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['bedrock:Converse'],
              resources: ['*'],
            }),
          ],
        }),
        PollyPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['polly:SynthesizeSpeech'],
              resources: ['*'],
            }),
          ],
        }),
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
              ],
              resources: [
                conversationTable.tableArn,
                usageTable.tableArn,
                `${usageTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        S3VectorsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                's3vectors:PutVectors',
                's3vectors:QueryVectors',
                's3vectors:GetVectors',
                's3vectors:DeleteVectors',
                's3vectors:ListVectors',
              ],
              resources: ['*'],
            }),
          ],
        }),
        // ユーザー管理 Lambda 用: Cognito Admin 操作
        CognitoAdminPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'cognito-idp:AdminDeleteUser',
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminDisableUser',
              ],
              resources: [userPool.userPoolArn],
            }),
          ],
        }),
        // ドキュメント取り込み API Lambda: SQS への送信権限
        SqsSendPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sqs:SendMessage'],
              resources: [ingestQueue.queueArn],
            }),
          ],
        }),
        // ドキュメント取り込み Worker Lambda: SQS からの受信・削除権限
        SqsReceivePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              resources: [ingestQueue.queueArn],
            }),
          ],
        }),
      },
    });

    // -------------------------------------------------------
    // 共通 Lambda 環境変数
    // -------------------------------------------------------
    const commonEnv: Record<string, string> = {
      REGION: 'ap-northeast-1',
      BEDROCK_AGENT_ID: agent.attrAgentId,
      BEDROCK_AGENT_ALIAS_ID: agentAlias.attrAgentAliasId,
      EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      CONVERSATION_TABLE: conversationTable.tableName,
      USAGE_TABLE: usageTable.tableName,
      VECTOR_BUCKET_NAME: vectorBucketName,
      VECTOR_INDEX_NAME: vectorIndexName,
      USER_POOL_ID: userPool.userPoolId,
      INGEST_QUEUE_URL: ingestQueue.queueUrl,
    };

    const bundlingOptions: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: false,
      target: 'node24',
      externalModules: [],
    };

    // -------------------------------------------------------
    // Lambda: 会議作成
    // -------------------------------------------------------
    const createMeetingLogGroup = new logs.LogGroup(this, 'CreateMeetingLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const createMeetingFn = new lambdaNodejs.NodejsFunction(this, 'CreateMeetingFunction', {
      functionName: 'chime-ai-create-meeting',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../lambda/create-meeting/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: createMeetingLogGroup,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: AI チャット (AgentCore + Polly + S3 Vectors RAG)
    // タイムアウトを 90s に設定:
    //   Titan Embeddings (~1s) + AgentCore InvokeAgent (~10-30s) + Polly (~2s)
    //   のシーケンシャル処理を余裕を持って収める
    // -------------------------------------------------------
    const aiChatLogGroup = new logs.LogGroup(this, 'AiChatLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const aiChatFn = new lambdaNodejs.NodejsFunction(this, 'AiChatFunction', {
      functionName: 'chime-ai-chat',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../lambda/ai-chat/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(90),
      memorySize: 512,
      logGroup: aiChatLogGroup,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: ドキュメント取り込み API (SQS へのエンキューのみ)
    // 入力検証後 SQS に送信して 202 を返す軽量関数。
    // 実際の埋め込み生成は ingest-document-worker が行う。
    // -------------------------------------------------------
    const ingestDocumentLogGroup = new logs.LogGroup(this, 'IngestDocumentLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const ingestDocumentFn = new lambdaNodejs.NodejsFunction(this, 'IngestDocumentFunction', {
      functionName: 'chime-ai-ingest-document',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../lambda/ingest-document/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10), // SQS 送信のみなので 10s で十分
      memorySize: 256,
      logGroup: ingestDocumentLogGroup,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: ドキュメント取り込みワーカー (SQS トリガー)
    //
    // ingestDocumentFn がキューに入れたメッセージを受け取り、
    // Titan Embeddings + S3 Vectors への書き込みを行う。
    // タイムアウトを 300s に設定し大量チャンクも処理できるようにする。
    // -------------------------------------------------------
    const ingestDocumentWorkerLogGroup = new logs.LogGroup(this, 'IngestDocumentWorkerLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const ingestDocumentWorkerFn = new lambdaNodejs.NodejsFunction(this, 'IngestDocumentWorkerFunction', {
      functionName: 'chime-ai-ingest-document-worker',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../lambda/ingest-document-worker/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(300), // 大きなドキュメントでも完了できる余裕を確保
      memorySize: 512,
      logGroup: ingestDocumentWorkerLogGroup,
      bundling: bundlingOptions,
    });

    // SQS トリガー: バッチサイズ 1 (各メッセージを独立して処理し、失敗を個別に DLQ に送る)
    ingestDocumentWorkerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(ingestQueue, {
        batchSize: 1,
        reportBatchItemFailures: true, // 部分的な失敗対応 (SQSBatchResponse)
      }),
    );

    // -------------------------------------------------------
    // Lambda: ユーザー管理 (GET /users, DELETE /users)
    // -------------------------------------------------------
    const userManagementLogGroup = new logs.LogGroup(this, 'UserManagementLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const userManagementFn = new lambdaNodejs.NodejsFunction(this, 'UserManagementFunction', {
      functionName: 'chime-ai-user-management',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../lambda/user-management/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: userManagementLogGroup,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: ドキュメント管理 (GET /documents, DELETE /documents)
    // -------------------------------------------------------
    const manageDocumentsLogGroup = new logs.LogGroup(this, 'ManageDocumentsLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const manageDocumentsFn = new lambdaNodejs.NodejsFunction(this, 'ManageDocumentsFunction', {
      functionName: 'chime-ai-manage-documents',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../lambda/manage-documents/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: manageDocumentsLogGroup,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // API Gateway — Cognito Authorizer
    // -------------------------------------------------------
    // API Gateway アクセスログ用 CloudWatch LogGroup
    // cdk-nag AwsSolutions-APIG1 / APIG6 準拠
    const apiAccessLogGroup = new logs.LogGroup(this, 'ApiAccessLog', {
      logGroupName: '/aws/apigateway/chime-ai-meeting-api',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const api = new apigateway.RestApi(this, 'ChimeAiMeetingApi', {
      restApiName: 'chime-ai-meeting-api',
      description: 'AI ビデオ会議システム API',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        // アクセスログ: リクエスト・レスポンス・レイテンシを記録
        accessLogDestination: new apigateway.LogGroupLogDestination(apiAccessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false, // リクエストボディのログ出力は無効 (機密情報漏洩防止)
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // HTTP セキュリティヘッダー: 4XX / 5XX エラーレスポンスにも付与
    // Lambda プロキシ統合の成功レスポンスは Lambda 関数側でヘッダーを設定する
    const securityResponseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': "'*'",
      'Strict-Transport-Security': "'max-age=63072000; includeSubDomains; preload'",
      'X-Content-Type-Options': "'nosniff'",
      'X-Frame-Options': "'DENY'",
      'X-XSS-Protection': "'1; mode=block'",
      'Referrer-Policy': "'strict-origin-when-cross-origin'",
    };
    const gatewayResponseTypes: Array<[string, apigateway.ResponseType]> = [
      ['BadRequestParams', apigateway.ResponseType.BAD_REQUEST_PARAMETERS],
      ['BadRequestBody', apigateway.ResponseType.BAD_REQUEST_BODY],
      ['AccessDenied', apigateway.ResponseType.ACCESS_DENIED],
      ['NotFound', apigateway.ResponseType.RESOURCE_NOT_FOUND],
      ['Throttled', apigateway.ResponseType.THROTTLED],
      ['Default5xx', apigateway.ResponseType.DEFAULT_5XX],
    ];
    for (const [id, responseType] of gatewayResponseTypes) {
      api.addGatewayResponse(`GwResp${id}`, {
        type: responseType,
        responseHeaders: securityResponseHeaders,
      });
    }

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: 'CognitoAuth',
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      },
    );

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // POST /meetings
    const meetingsResource = api.root.addResource('meetings');
    meetingsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(createMeetingFn, { proxy: true }),
      authMethodOptions,
    );

    // POST /ai-chat
    const aiChatResource = api.root.addResource('ai-chat');
    aiChatResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(aiChatFn, { proxy: true }),
      authMethodOptions,
    );

    // POST /documents (登録), GET /documents (一覧), DELETE /documents (削除)
    const documentsResource = api.root.addResource('documents');
    documentsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(ingestDocumentFn, { proxy: true }),
      authMethodOptions,
    );
    documentsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(manageDocumentsFn, { proxy: true }),
      authMethodOptions,
    );
    documentsResource.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(manageDocumentsFn, { proxy: true }),
      authMethodOptions,
    );

    // GET /users, DELETE /users — ユーザー情報取得・アカウント削除
    const usersResource = api.root.addResource('users');
    usersResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userManagementFn, { proxy: true }),
      authMethodOptions,
    );
    usersResource.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(userManagementFn, { proxy: true }),
      authMethodOptions,
    );

    // -------------------------------------------------------
    // Amplify ホスティング
    // -------------------------------------------------------
    const amplifyApp = new amplify.CfnApp(this, 'AmplifyApp', {
      name: 'chime-ai-meeting',
      platform: 'WEB',
      buildSpec: [
        'version: 1',
        'frontend:',
        '  phases:',
        '    preBuild:',
        '      commands:',
        '        - cd frontend',
        '        - npm install',
        '    build:',
        '      commands:',
        '        - npm run build',
        '  artifacts:',
        '    baseDirectory: frontend/dist',
        '    files:',
        "      - '**/*'",
        '  cache:',
        '    paths:',
        '      - frontend/node_modules/**/*',
      ].join('\n'),
      customRules: [
        {
          source:
            '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|mp4|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
      // Amplify はマニュアルデプロイ (zip 形式) を使用しているため customHttp.yml を読まない。
      // セキュリティヘッダーを CfnApp に直接設定して CloudFront に確実に反映させる。
      customHeaders: [
        'customHeaders:',
        '  - pattern: "/index.html"',
        '    headers:',
        '      - key: Cache-Control',
        '        value: "no-cache, no-store, must-revalidate"',
        '      - key: Pragma',
        '        value: no-cache',
        '  - pattern: "/assets/**"',
        '    headers:',
        '      - key: Cache-Control',
        '        value: "public, max-age=31536000, immutable"',
        '  - pattern: "**/*.mp4"',
        '    headers:',
        '      - key: Cache-Control',
        '        value: "public, max-age=604800"',
        '  - pattern: "**/*"',
        '    headers:',
        '      - key: Strict-Transport-Security',
        '        value: "max-age=31536000; includeSubDomains; preload"',
        '      - key: X-Frame-Options',
        '        value: DENY',
        '      - key: X-Content-Type-Options',
        '        value: nosniff',
        '      - key: Referrer-Policy',
        '        value: strict-origin-when-cross-origin',
        '      - key: Content-Security-Policy',
        // connect-src の補足:
        //   https://*.chime.aws       → 1階層サブドメイン (meetings.chime.aws 等)
        //   https://*.sdkassets.chime.aws → static.sdkassets.chime.aws (SDK ワーカー取得)
        //   https://data.svc.an1.ingest.chime.aws → Chime テレメトリ (4階層のため完全一致)
        //   worker-src blob:          → AudioRedWorker が blob: URL で作成される
        "        value: \"default-src 'self'; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com https://*.chime.aws https://*.sdkassets.chime.aws https://data.svc.an1.ingest.chime.aws wss://*.amazonaws.com wss://*.chime.aws; worker-src blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';\"",
      ].join('\n'),
    });

    new amplify.CfnBranch(this, 'AmplifyMainBranch', {
      appId: amplifyApp.attrAppId,
      branchName: 'main',
      enableAutoBuild: false,
      stage: 'PRODUCTION',
      environmentVariables: [
        { name: 'VITE_API_URL', value: api.url },
        { name: 'VITE_REGION', value: 'ap-northeast-1' },
        { name: 'VITE_COGNITO_USER_POOL_ID', value: userPool.userPoolId },
        { name: 'VITE_COGNITO_CLIENT_ID', value: userPoolClient.userPoolClientId },
      ],
    });

    // -------------------------------------------------------
    // CloudFormation 出力
    // -------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway エンドポイント URL',
      exportName: 'ChimeAiMeetingApiUrl',
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'ChimeAiCognitoUserPoolId',
    });
    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
      exportName: 'ChimeAiCognitoClientId',
    });
    new cdk.CfnOutput(this, 'BedrockAgentId', {
      value: agent.attrAgentId,
      description: 'Bedrock AgentCore エージェント ID',
      exportName: 'ChimeAiBedrockAgentId',
    });
    new cdk.CfnOutput(this, 'BedrockAgentAliasId', {
      value: agentAlias.attrAgentAliasId,
      description: 'Bedrock AgentCore エイリアス ID',
      exportName: 'ChimeAiBedrockAgentAliasId',
    });
    new cdk.CfnOutput(this, 'AmplifyAppId', {
      value: amplifyApp.attrAppId,
      description: 'Amplify App ID',
      exportName: 'ChimeAiMeetingAmplifyAppId',
    });
    new cdk.CfnOutput(this, 'AmplifyDefaultDomain', {
      value: `https://main.${amplifyApp.attrDefaultDomain}`,
      description: 'Amplify ホスティング URL',
      exportName: 'ChimeAiMeetingAmplifyUrl',
    });
    new cdk.CfnOutput(this, 'UsageTableName', {
      value: usageTable.tableName,
      description: '利用記録 DynamoDB テーブル',
    });
    new cdk.CfnOutput(this, 'VectorBucketName', {
      value: vectorBucketName,
      description: 'S3 Vectors バケット名',
    });
    new cdk.CfnOutput(this, 'IngestQueueUrl', {
      value: ingestQueue.queueUrl,
      description: 'ドキュメント取り込み SQS キュー URL',
    });
    new cdk.CfnOutput(this, 'IngestDlqUrl', {
      value: ingestDlq.queueUrl,
      description: 'ドキュメント取り込み DLQ URL (失敗メッセージを確認するために使用)',
    });
  }
}
