import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * CI/CD スタック
 *
 * CodeCommit main ブランチへの push をトリガーに以下の 4 ステージが順番に実行される:
 *
 *   Source  → Test          → CDKDeploy          → FrontendDeploy
 *   (取得)    (CDK Jest)      (cdk deploy)          (Vite build +
 *                                                   Amplify upload +
 *                                                   CloudFront invalidate)
 *
 * 各ステージが独立した CodeBuild プロジェクトで実行されるため、
 * コンソールで進捗・ログをステージ単位で確認できる。
 *
 * 初回・更新時は手動で実行:
 *   npx cdk deploy CicdStack
 */
export class CicdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const REGION = 'ap-northeast-1';
    const MAIN_STACK = 'ChimeAiMeetingStack';

    // -------------------------------------------------------
    // 既存の CodeCommit リポジトリを参照
    // -------------------------------------------------------
    const repo = codecommit.Repository.fromRepositoryName(
      this,
      'AppRepo',
      'chime-ai-meeting',
    );

    // -------------------------------------------------------
    // 共通 IAM ロール (全 CodeBuild プロジェクトで共用)
    // -------------------------------------------------------
    const buildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'CodeBuild role for ChimeAiMeeting CI/CD pipeline',
      managedPolicies: [
        // CDK deploy に必要なサービス権限 (CloudFormation 含む)
        iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess'),
      ],
    });
    // CDK Bootstrap / IAM ロール作成
    buildRole.addToPolicy(new iam.PolicyStatement({
      sid: 'IamForCdk',
      actions: [
        'iam:CreateRole', 'iam:DeleteRole',
        'iam:AttachRolePolicy', 'iam:DetachRolePolicy',
        'iam:PutRolePolicy', 'iam:DeleteRolePolicy',
        'iam:GetRole', 'iam:PassRole', 'iam:TagRole',
        'iam:UpdateRole', 'iam:UpdateAssumeRolePolicy',
      ],
      resources: ['*'],
    }));
    // Amplify デプロイ
    buildRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AmplifyDeploy',
      actions: [
        'amplify:CreateDeployment', 'amplify:StartDeployment',
        'amplify:StartJob',   // git 接続済みアプリの RELEASE トリガー
        'amplify:StopJob', 'amplify:GetJob', 'amplify:ListJobs',
        'amplify:GetApp', 'amplify:UpdateApp',
      ],
      resources: ['*'],
    }));
    // CloudFront キャッシュ無効化
    buildRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudFrontInvalidation',
      actions: [
        'cloudfront:CreateInvalidation',
        'cloudfront:ListDistributions',
      ],
      resources: ['*'],
    }));

    // -------------------------------------------------------
    // 共通 CodeBuild 環境設定
    // -------------------------------------------------------
    const commonEnv: codebuild.BuildEnvironment = {
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      computeType: codebuild.ComputeType.MEDIUM,
    };

    const makeLogGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/codebuild/chime-ai-meeting/${name}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    // -------------------------------------------------------
    // Stage 2: Test — CDK Jest テスト
    // -------------------------------------------------------
    const testProject = new codebuild.PipelineProject(this, 'TestProject', {
      projectName: 'chime-ai-meeting-test',
      role: buildRole,
      environment: commonEnv,
      timeout: cdk.Duration.minutes(15),
      logging: { cloudWatch: { logGroup: makeLogGroup('test'), prefix: 'test' } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: { 'runtime-versions': { nodejs: 24 } },
          pre_build: { commands: ['cd cdk', 'npm ci'] },
          build: { commands: ['npm test -- --passWithNoTests'] },
        },
      }),
    });

    // -------------------------------------------------------
    // Stage 3: CDKDeploy — cdk deploy ChimeAiMeetingStack
    // cdk-outputs.json をアーティファクトとして次ステージへ渡す
    // -------------------------------------------------------
    const cdkDeployProject = new codebuild.PipelineProject(this, 'CdkDeployProject', {
      projectName: 'chime-ai-meeting-cdk-deploy',
      role: buildRole,
      environment: commonEnv,
      timeout: cdk.Duration.minutes(20),
      logging: { cloudWatch: { logGroup: makeLogGroup('cdk-deploy'), prefix: 'cdk' } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: { 'runtime-versions': { nodejs: 24 } },
          pre_build: { commands: ['cd cdk', 'npm ci'] },
          build: {
            commands: [
              // CDK Bootstrap (冪等)
              `npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/${REGION} --region ${REGION} 2>/dev/null || true`,
              // アプリスタックのみデプロイ (CicdStack は除外)
              `npx cdk deploy ${MAIN_STACK} --require-approval never --region ${REGION} --outputs-file cdk-outputs.json`,
            ],
          },
        },
        artifacts: {
          // cdk-outputs.json を次ステージ (FrontendDeploy) に渡す
          files: ['cdk/cdk-outputs.json'],
        },
      }),
    });

    // -------------------------------------------------------
    // Stage 4: FrontendDeploy — Vite build + Amplify deploy + CloudFront
    // -------------------------------------------------------
    const frontendDeployProject = new codebuild.PipelineProject(this, 'FrontendDeployProject', {
      projectName: 'chime-ai-meeting-frontend-deploy',
      role: buildRole,
      environment: commonEnv,
      timeout: cdk.Duration.minutes(15),
      logging: { cloudWatch: { logGroup: makeLogGroup('frontend-deploy'), prefix: 'frontend' } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: { 'runtime-versions': { nodejs: 24 } },
          pre_build: { commands: ['cd frontend', 'npm ci', 'cd ..'] },
          build: {
            commands: [
              // CDK outputs から環境変数を取得
              `API_URL=$(node -e "const o=require('./cdk/cdk-outputs.json');console.log(Object.values(o)[0].ApiUrl)")`,
              `AMPLIFY_APP_ID=$(node -e "const o=require('./cdk/cdk-outputs.json');console.log(Object.values(o)[0].AmplifyAppId)")`,
              `COGNITO_USER_POOL_ID=$(node -e "const o=require('./cdk/cdk-outputs.json');console.log(Object.values(o)[0].CognitoUserPoolId)")`,
              `COGNITO_CLIENT_ID=$(node -e "const o=require('./cdk/cdk-outputs.json');console.log(Object.values(o)[0].CognitoClientId)")`,
              // フロントエンドビルド
              'cd frontend',
              `VITE_API_URL="$API_URL" VITE_REGION="${REGION}" VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" npm run build`,
              'cd ..',
              // Amplify デプロイ (deploy.sh と同じ: git 接続確認 → 分岐)
              'DIST_ZIP=/tmp/frontend-dist.zip',
              'cd frontend/dist && zip -r "$DIST_ZIP" . > /dev/null && cd ../..',
              // 進行中ジョブをキャンセル
              `RUNNING_JOB=$(aws amplify list-jobs --app-id "$AMPLIFY_APP_ID" --branch-name main --region ${REGION} --max-results 1 --query 'jobSummaries[?status==\`RUNNING\` || status==\`PENDING\`].jobId' --output text 2>/dev/null || true)`,
              `if [ -n "$RUNNING_JOB" ] && [ "$RUNNING_JOB" != "None" ]; then aws amplify stop-job --app-id "$AMPLIFY_APP_ID" --branch-name main --job-id "$RUNNING_JOB" --region ${REGION} > /dev/null; sleep 3; fi`,
              // git 接続確認
              `REPO_URL=$(aws amplify get-app --app-id "$AMPLIFY_APP_ID" --region ${REGION} --query 'app.repository' --output text 2>/dev/null || echo "None")`,
              // git 接続済み → start-job RELEASE / 非接続 → create-deployment + zip upload
              `if [ -n "$REPO_URL" ] && [ "$REPO_URL" != "None" ]; then
                echo "git 接続済み: Amplify ビルドをトリガー (repo: $REPO_URL)"
                rm -f "$DIST_ZIP"
                JOB_RESPONSE=$(aws amplify start-job --app-id "$AMPLIFY_APP_ID" --branch-name main --job-type RELEASE --region ${REGION} --output json)
                JOB_ID=$(echo "$JOB_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).jobSummary.jobId));")
                echo "Amplify ビルド開始 (job: $JOB_ID)"
              else
                echo "手動デプロイ: zip をアップロード"
                DEPLOY_RESPONSE=$(aws amplify create-deployment --app-id "$AMPLIFY_APP_ID" --branch-name main --region ${REGION} --output json)
                JOB_ID=$(echo "$DEPLOY_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).jobId));")
                UPLOAD_URL=$(echo "$DEPLOY_RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).zipUploadUrl));")
                curl -s -H "Content-Type: application/zip" --upload-file "$DIST_ZIP" "$UPLOAD_URL"
                rm -f "$DIST_ZIP"
                aws amplify start-deployment --app-id "$AMPLIFY_APP_ID" --branch-name main --job-id "$JOB_ID" --region ${REGION} > /dev/null
              fi`,
              // 完了待機 (最大 10 分)
              `for i in $(seq 1 60); do sleep 10; STATUS=$(aws amplify get-job --app-id "$AMPLIFY_APP_ID" --branch-name main --job-id "$JOB_ID" --region ${REGION} --query 'job.summary.status' --output text); echo "($((i*10))s) Amplify: $STATUS"; if [ "$STATUS" = "SUCCEED" ]; then break; elif [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "CANCELLED" ]; then echo "Amplify deploy failed"; exit 1; fi; done`,
              // CloudFront キャッシュ無効化
              `CF_DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, '$AMPLIFY_APP_ID')].Id" --output text 2>/dev/null || true)`,
              `if [ -n "$CF_DIST_ID" ] && [ "$CF_DIST_ID" != "None" ]; then aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths '/*' > /dev/null && echo "CloudFront cache invalidated"; fi`,
            ],
          },
        },
      }),
    });

    // -------------------------------------------------------
    // CodePipeline — 4 ステージ構成
    // -------------------------------------------------------
    const sourceOutput     = new codepipeline.Artifact('SourceOutput');
    const cdkOutputArtifact = new codepipeline.Artifact('CdkOutputArtifact');

    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'chime-ai-meeting-pipeline',
      stages: [
        // ── 1. Source ─────────────────────────────────────
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: repo,
              branch: 'main',
              output: sourceOutput,
              trigger: codepipeline_actions.CodeCommitTrigger.EVENTS,
            }),
          ],
        },
        // ── 2. Test ───────────────────────────────────────
        {
          stageName: 'Test',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Jest_Test',
              project: testProject,
              input: sourceOutput,
            }),
          ],
        },
        // ── 3. CDKDeploy ──────────────────────────────────
        {
          stageName: 'CDKDeploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Deploy',
              project: cdkDeployProject,
              input: sourceOutput,
              outputs: [cdkOutputArtifact],
            }),
          ],
        },
        // ── 4. FrontendDeploy ─────────────────────────────
        {
          stageName: 'FrontendDeploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Frontend_Build_And_Amplify_Deploy',
              project: frontendDeployProject,
              // ソースコード + CDK outputs の両方を入力
              input: sourceOutput,
              extraInputs: [cdkOutputArtifact],
            }),
          ],
        },
      ],
    });
  }
}
