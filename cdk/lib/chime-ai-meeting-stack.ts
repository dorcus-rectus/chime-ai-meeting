import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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
        requireSymbols: false,
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
    };

    const bundlingOptions: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: false,
      target: 'node20',
      externalModules: [],
    };

    // -------------------------------------------------------
    // Lambda: 会議作成
    // -------------------------------------------------------
    const createMeetingFn = new lambdaNodejs.NodejsFunction(this, 'CreateMeetingFunction', {
      functionName: 'chime-ai-create-meeting',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/create-meeting/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: AI チャット (AgentCore + Polly + S3 Vectors RAG)
    // タイムアウトを 90s に設定:
    //   Titan Embeddings (~1s) + AgentCore InvokeAgent (~10-30s) + Polly (~2s)
    //   のシーケンシャル処理を余裕を持って収める
    // -------------------------------------------------------
    const aiChatFn = new lambdaNodejs.NodejsFunction(this, 'AiChatFunction', {
      functionName: 'chime-ai-chat',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/ai-chat/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(90),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: ドキュメント取り込み (RAG インデックス構築)
    // API Gateway の統合タイムアウトは 29 秒のハードリミットのため、
    // Lambda タイムアウトを 28 秒に合わせる。埋め込み処理は並列化済み。
    // -------------------------------------------------------
    const ingestDocumentFn = new lambdaNodejs.NodejsFunction(this, 'IngestDocumentFunction', {
      functionName: 'chime-ai-ingest-document',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/ingest-document/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(28),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // Lambda: ユーザー管理 (GET /users, DELETE /users)
    // -------------------------------------------------------
    const userManagementFn = new lambdaNodejs.NodejsFunction(this, 'UserManagementFunction', {
      functionName: 'chime-ai-user-management',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/user-management/index.ts'),
      handler: 'handler',
      role: lambdaRole,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: bundlingOptions,
    });

    // -------------------------------------------------------
    // API Gateway — Cognito Authorizer
    // -------------------------------------------------------
    const api = new apigateway.RestApi(this, 'ChimeAiMeetingApi', {
      restApiName: 'chime-ai-meeting-api',
      description: 'AI ビデオ会議システム API',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
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

    // POST /documents
    const documentsResource = api.root.addResource('documents');
    documentsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(ingestDocumentFn, { proxy: true }),
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
            '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
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
  }
}
