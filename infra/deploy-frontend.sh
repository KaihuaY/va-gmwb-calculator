#!/usr/bin/env bash
# Build and deploy the React frontend to S3 + invalidate CloudFront.
#
# Prerequisites:
#   - AWS CLI configured
#   - Node.js >= 18 and npm installed
#   - S3 bucket and CloudFront distribution already created
#   - VITE_API_URL set to your Lambda Function URL
#
# Usage:
#   S3_BUCKET=your-bucket-name \
#   CF_DISTRIBUTION_ID=EXXXXXXXXX \
#   VITE_API_URL=https://xxxxxx.lambda-url.us-east-1.on.aws \
#   ./infra/deploy-frontend.sh

set -euo pipefail

S3_BUCKET="${S3_BUCKET:?Set S3_BUCKET to your S3 bucket name}"
CF_DISTRIBUTION_ID="${CF_DISTRIBUTION_ID:?Set CF_DISTRIBUTION_ID to your CloudFront distribution ID}"
VITE_API_URL="${VITE_API_URL:?Set VITE_API_URL to your Lambda Function URL}"

FRONTEND_DIR="$(cd "$(dirname "$0")/../frontend" && pwd)"

echo "==> Building React app"
echo "    API URL: $VITE_API_URL"

cd "$FRONTEND_DIR"

# Write .env.production (not committed to git)
echo "VITE_API_URL=$VITE_API_URL" > .env.production

npm ci --quiet
npm run build

echo "==> Syncing dist/ to s3://$S3_BUCKET"
aws s3 sync dist/ "s3://$S3_BUCKET" \
  --delete \
  --cache-control "max-age=31536000,immutable" \
  --exclude "index.html"

# index.html should not be cached aggressively
aws s3 cp dist/index.html "s3://$S3_BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate"

echo "==> Invalidating CloudFront distribution $CF_DISTRIBUTION_ID"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "    Invalidation ID: $INVALIDATION_ID"
echo "    (Propagation takes ~1 min. Run 'aws cloudfront wait invalidation-completed ...' to wait.)"

echo "==> Done."
