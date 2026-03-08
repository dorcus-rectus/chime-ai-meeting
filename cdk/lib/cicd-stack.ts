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
 * CodeCommit main ブランチへの push をトリガーに CodePipeline が起動し、
 * buildspec-cdk.yml 経由で deploy.sh を実行する。
 *
 * deploy.sh の実行内容:
 *   1. CDK Jest テスト
 *   2. CDK デプロイ (ChimeAiMeetingStack)
 *   3. フロントエンドビルド (Vite)
 *   4. Amplify zip アップロード & デプロイ待機
 *   5. CloudFront キャッシュ無効化
 *
 * 初回・更新時は手動で npx cdk deploy CicdStack を実行する。
 */
export class CicdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -------------------------------------------------------
    // 既存の CodeCommit リポジトリを参照
    // -------------------------------------------------------
    const repo = codecommit.Repository.fromRepositoryName(
      this,
      'AppRepo',
      'chime-ai-meeting',
    );

    // -------------------------------------------------------
    // CodeBuild IAM ロール
    // deploy.sh が使用するすべての AWS サービスへの権限を付与
    // -------------------------------------------------------
    const buildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'CodeBuild role for deploying ChimeAiMeetingStack + Amplify frontend',
    });

    // CDK デプロイに必要な権限 (CloudFormation + 各サービス)
    buildRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess'),
    );
    // CDK Bootstrap / IAM ロール作成に必要
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IamForCdk',
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:GetRole',
          'iam:PassRole',
          'iam:TagRole',
          'iam:UpdateRole',
          'iam:UpdateAssumeRolePolicy',
        ],
        resources: ['*'],
      }),
    );
    // Amplify デプロイ (deploy.sh が使用)
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AmplifyDeploy',
        actions: [
          'amplify:CreateDeployment',
          'amplify:StartDeployment',
          'amplify:StopJob',
          'amplify:GetJob',
          'amplify:ListJobs',
          'amplify:GetApp',
          'amplify:UpdateApp',
        ],
        resources: ['*'],
      }),
    );
    // CloudFront キャッシュ無効化 (deploy.sh が使用)
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidation',
        actions: [
          'cloudfront:CreateInvalidation',
          'cloudfront:ListDistributions',
        ],
        resources: ['*'],
      }),
    );

    // -------------------------------------------------------
    // CodeBuild プロジェクト
    // -------------------------------------------------------
    const buildLogGroup = new logs.LogGroup(this, 'BuildLogs', {
      logGroupName: '/codebuild/chime-ai-meeting',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: 'chime-ai-meeting-deploy',
      role: buildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        // deploy.sh 内で docker コマンドは使わないため privileged 不要
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-cdk.yml'),
      timeout: cdk.Duration.minutes(30),
      logging: {
        cloudWatch: {
          logGroup: buildLogGroup,
          prefix: 'build',
        },
      },
      environmentVariables: {
        // CDK_DEFAULT_ACCOUNT は CodeBuild の環境変数から自動設定されるが
        // deploy.sh 内の aws sts get-caller-identity で解決するため明示不要
      },
    });

    // -------------------------------------------------------
    // CodePipeline
    // -------------------------------------------------------
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput  = new codepipeline.Artifact('BuildOutput');

    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'chime-ai-meeting-pipeline',
      // CodeCommit → CodeBuild の 2 ステージ構成
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeCommitSourceAction({
              actionName: 'CodeCommit_Source',
              repository: repo,
              branch: 'main',
              output: sourceOutput,
              // push をトリガーに EventBridge 経由で即時起動
              trigger: codepipeline_actions.CodeCommitTrigger.EVENTS,
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_And_Amplify_Deploy',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
      // パイプライン自体のアーティファクト保存用 S3 は CDK が自動作成
    });
  }
}
