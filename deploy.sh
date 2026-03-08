#!/bin/bash
set -euo pipefail

# ============================================================
# AI ビデオ会議システム デプロイスクリプト
# リージョン: ap-northeast-1 (東京)
#
# 過去のデプロイで発生したエラーへの対応:
#   1. スタックが ROLLBACK_COMPLETE 状態 → 自動削除して再デプロイ
#   2. DynamoDB テーブルが RETAIN で残存 → スタック削除前に手動削除
#   3. Amplify zip パス問題 → 絶対パスに統一
#   4. Amplify 進行中ジョブがブロック → 既存ジョブを自動キャンセル
#   5. デプロイ完了を待たずに終了 → SUCCEED/FAILED まで polling
# ============================================================

REGION="ap-northeast-1"
STACK_NAME="ChimeAiMeetingStack"
CDK_DIR="$(cd "$(dirname "$0")/cdk" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"
DIST_ZIP="/tmp/chime-ai-frontend-dist.zip"

echo "======================================"
echo "  AI ビデオ会議システム デプロイ"
echo "  リージョン: $REGION"
echo "======================================"

# -------------------------------------------------------
# 0. スタック状態の確認 — ROLLBACK_COMPLETE なら削除してリセット
#
# CDK は ROLLBACK_COMPLETE 状態のスタックにデプロイできない。
# このとき DynamoDB テーブルは RemovalPolicy.DESTROY により
# スタック削除時に一緒に削除される。
# -------------------------------------------------------
echo ""
echo "[0/5] スタック状態を確認中..."

STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "DOES_NOT_EXIST")

echo "  スタック状態: $STACK_STATUS"

if [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "  ⚠️  ROLLBACK_COMPLETE 状態のためスタックを削除します..."
  aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "$REGION"
  echo "  削除完了を待機中 (数分かかります)..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "$STACK_NAME" \
    --region "$REGION"
  echo "  スタック削除完了"
elif [ "$STACK_STATUS" = "DOES_NOT_EXIST" ]; then
  echo "  スタックは存在しません (初回デプロイ)"
else
  echo "  スタックは正常状態です"
fi

# -------------------------------------------------------
# 1. CDK 依存関係インストール & デプロイ
# -------------------------------------------------------
echo ""
echo "[1/5] CDK 依存関係をインストール中..."
cd "$CDK_DIR"
npm install

echo ""
echo "[2/5] CDK をデプロイ中 (初回は ~5分かかります)..."
npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/$REGION" \
  --region "$REGION" 2>/dev/null || true

npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  --region "$REGION" \
  --outputs-file cdk-outputs.json

# -------------------------------------------------------
# 2. CDK 出力から API URL と Amplify App ID を取得
# -------------------------------------------------------
echo ""
echo "[3/5] デプロイ出力を読み込み中..."

_out() {
  node -e "
    const o = require('${CDK_DIR}/cdk-outputs.json');
    const stack = Object.values(o)[0];
    console.log(stack['$1']);
  "
}

API_URL=$(_out ApiUrl)
AMPLIFY_APP_ID=$(_out AmplifyAppId)
AMPLIFY_URL=$(_out AmplifyDefaultDomain)
COGNITO_USER_POOL_ID=$(_out CognitoUserPoolId)
COGNITO_CLIENT_ID=$(_out CognitoClientId)

echo "  API URL:              $API_URL"
echo "  Cognito User Pool ID: $COGNITO_USER_POOL_ID"
echo "  Cognito Client ID:    $COGNITO_CLIENT_ID"
echo "  Amplify App ID:       $AMPLIFY_APP_ID"
echo "  Amplify URL:          $AMPLIFY_URL"

# -------------------------------------------------------
# 3. フロントエンドビルド
# -------------------------------------------------------
echo ""
echo "[4/5] フロントエンドをビルド中..."
cd "$FRONTEND_DIR"
npm install

VITE_API_URL="$API_URL" \
VITE_REGION="$REGION" \
VITE_COGNITO_USER_POOL_ID="$COGNITO_USER_POOL_ID" \
VITE_COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
npm run build

# dist/ を zip 化 (絶対パスを使用してパス問題を回避)
rm -f "$DIST_ZIP"
cd "$FRONTEND_DIR/dist"
zip -r "$DIST_ZIP" . > /dev/null
cd "$FRONTEND_DIR"
echo "  zip サイズ: $(du -sh "$DIST_ZIP" | cut -f1)"

# -------------------------------------------------------
# 4. Amplify へデプロイ
#
# git リポジトリ接続済みアプリ: create-deployment は使用不可
# (BadRequestException: Operation not supported. App is already connected a repository)
# → start-job --job-type RELEASE で Amplify 自身にビルドさせる。
#   Amplify ブランチ環境変数 (VITE_*) は CDK でセット済みのため
#   Amplify ビルド時に自動参照される。
#
# git 非接続アプリ: create-deployment + zip upload の手動デプロイを使用。
# -------------------------------------------------------
echo ""
echo "[5/5] Amplify へデプロイ中..."

# 進行中のジョブがあればキャンセルする
# (BadRequestException: last job was not finished を防ぐ)
RUNNING_JOB=$(aws amplify list-jobs \
  --app-id "$AMPLIFY_APP_ID" \
  --branch-name main \
  --region "$REGION" \
  --max-results 1 \
  --query 'jobSummaries[?status==`RUNNING` || status==`PENDING`].jobId' \
  --output text 2>/dev/null || echo "")

if [ -n "$RUNNING_JOB" ] && [ "$RUNNING_JOB" != "None" ]; then
  echo "  進行中のジョブ ($RUNNING_JOB) をキャンセル中..."
  aws amplify stop-job \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name main \
    --job-id "$RUNNING_JOB" \
    --region "$REGION" > /dev/null 2>&1 || true
  sleep 3
fi

# アプリが git リポジトリに接続されているか確認
REPO_URL=$(aws amplify get-app \
  --app-id "$AMPLIFY_APP_ID" \
  --region "$REGION" \
  --query 'app.repository' \
  --output text 2>/dev/null || echo "None")

if [ -n "$REPO_URL" ] && [ "$REPO_URL" != "None" ]; then
  # --- git 接続済み: start-job で Amplify 自身にビルドさせる ---
  echo "  git 接続済みアプリ: Amplify ビルドをトリガー中 (repo: $REPO_URL)..."
  rm -f "$DIST_ZIP"
  JOB_RESPONSE=$(aws amplify start-job \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name main \
    --job-type RELEASE \
    --region "$REGION" \
    --output json)
  JOB_ID=$(echo "$JOB_RESPONSE" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).jobSummary.jobId));")
  echo "  Amplify ビルド開始 (job: $JOB_ID)"
else
  # --- git 非接続: zip アップロードによる手動デプロイ ---
  echo "  手動デプロイ: zip をアップロード中..."
  DEPLOY_RESPONSE=$(aws amplify create-deployment \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name main \
    --region "$REGION" \
    --output json)
  JOB_ID=$(echo "$DEPLOY_RESPONSE" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).jobId));")
  UPLOAD_URL=$(echo "$DEPLOY_RESPONSE" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).zipUploadUrl));")
  echo "  zip をアップロード中 (job: $JOB_ID)..."
  curl -s -H "Content-Type: application/zip" --upload-file "$DIST_ZIP" "$UPLOAD_URL"
  rm -f "$DIST_ZIP"
  aws amplify start-deployment \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name main \
    --job-id "$JOB_ID" \
    --region "$REGION" > /dev/null
fi

# デプロイ完了まで待機 (最大 5 分 = 30回 × 10秒)
echo "  Amplify デプロイ完了を待機中..."
for i in $(seq 1 30); do
  sleep 10
  JOB_STATUS=$(aws amplify get-job \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name main \
    --job-id "$JOB_ID" \
    --region "$REGION" \
    --query 'job.summary.status' \
    --output text)
  echo "    ($((i * 10))s) ステータス: $JOB_STATUS"
  if [ "$JOB_STATUS" = "SUCCEED" ]; then
    break
  elif [ "$JOB_STATUS" = "FAILED" ] || [ "$JOB_STATUS" = "CANCELLED" ]; then
    echo ""
    echo "  ❌ Amplify デプロイが失敗しました (status: $JOB_STATUS)"
    echo "     コンソールで詳細を確認してください:"
    echo "     https://ap-northeast-1.console.aws.amazon.com/amplify/apps/$AMPLIFY_APP_ID"
    exit 1
  fi
done

if [ "$JOB_STATUS" != "SUCCEED" ]; then
  echo ""
  echo "  ⚠️  タイムアウト: Amplify デプロイがまだ完了していません"
  echo "     コンソールで確認してください:"
  echo "     https://ap-northeast-1.console.aws.amazon.com/amplify/apps/$AMPLIFY_APP_ID"
else
  # -------------------------------------------------------
  # 5. CloudFront キャッシュ無効化 (古い JS/CSS を確実に削除)
  # -------------------------------------------------------
  echo ""
  echo "  CloudFront キャッシュを無効化中..."
  # Amplify のドメインに紐づく CloudFront Distribution ID を取得 (us-east-1 で検索)
  CF_DIST_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, '${AMPLIFY_APP_ID}')].Id" \
    --output text 2>/dev/null || echo "")

  if [ -n "$CF_DIST_ID" ] && [ "$CF_DIST_ID" != "None" ]; then
    INVAL_ID=$(aws cloudfront create-invalidation \
      --distribution-id "$CF_DIST_ID" \
      --paths '/*' \
      --query 'Invalidation.Id' \
      --output text 2>/dev/null || echo "")
    if [ -n "$INVAL_ID" ]; then
      echo "  キャッシュ無効化開始 (ID: $INVAL_ID) — 完了まで 1〜2 分"
    fi
  else
    echo "  CloudFront Distribution が見つかりませんでした (Amplify が自動処理済みの可能性あり)"
  fi

  echo ""
  echo "======================================"
  echo "  デプロイ完了!"
  echo "======================================"
  echo ""
  echo "  アプリ URL: $AMPLIFY_URL"
  echo "  API URL:    $API_URL"
  echo ""
  echo "  ※ Bedrock で以下のモデルアクセスを有効化してください:"
  echo "    - jp.anthropic.claude-sonnet-4-6 (Claude Sonnet 4.6)"
  echo "    - amazon.titan-embed-text-v2:0 (Titan Embeddings V2)"
  echo "    https://ap-northeast-1.console.aws.amazon.com/bedrock/home#/modelaccess"
  echo ""
fi
