#!/usr/bin/env bash
# First-time setup: create the Lambda function and enable a Function URL.
#
# Run this once. After that use deploy-backend.sh for updates.
#
# Prerequisites:
#   - AWS CLI configured with sufficient IAM permissions
#   - A Lambda execution role with AWSLambdaBasicExecutionRole policy
#
# Usage:
#   LAMBDA_ROLE_ARN=arn:aws:iam::123456789:role/lambda-basic-role \
#   ./infra/create-lambda.sh

set -euo pipefail

FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-va-gmwb-api}"
ROLE_ARN="${LAMBDA_ROLE_ARN:?Set LAMBDA_ROLE_ARN to your Lambda execution role ARN}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

echo "==> Creating Lambda function: $FUNCTION_NAME"

# Build a minimal placeholder zip (will be replaced by deploy-backend.sh)
PLACEHOLDER=$(mktemp).zip
echo 'def handler(event, context): return {"statusCode": 200}' > /tmp/placeholder_handler.py
zip -q "$PLACEHOLDER" -j /tmp/placeholder_handler.py

aws lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime python3.12 \
  --architectures arm64 \
  --role "$ROLE_ARN" \
  --handler handler.handler \
  --timeout 30 \
  --memory-size 512 \
  --zip-file "fileb://$PLACEHOLDER" \
  --region "$REGION"

echo "==> Waiting for function to be active..."
aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"

echo "==> Adding Function URL (CORS open — restrict after deployment)"
aws lambda create-function-url-config \
  --function-name "$FUNCTION_NAME" \
  --auth-type NONE \
  --cors '{
    "AllowOrigins": ["*"],
    "AllowMethods": ["GET","POST"],
    "AllowHeaders": ["content-type"],
    "MaxAge": 300
  }' \
  --region "$REGION"

echo "==> Adding resource-based policy for public access"
aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region "$REGION"

echo "==> Lambda Function URL:"
aws lambda get-function-url-config \
  --function-name "$FUNCTION_NAME" \
  --query 'FunctionUrl' \
  --output text \
  --region "$REGION"

echo ""
echo "==> Next steps:"
echo "    1. Run: ./infra/deploy-backend.sh  (to upload the real code)"
echo "    2. Set VITE_API_URL to the Function URL above"
echo "    3. Run: ./infra/deploy-frontend.sh (to deploy the React app)"

rm -f "$PLACEHOLDER" /tmp/placeholder_handler.py
