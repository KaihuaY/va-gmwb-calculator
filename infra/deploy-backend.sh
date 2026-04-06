#!/usr/bin/env bash
# Deploy Python backend to AWS Lambda.
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - Lambda function already created (see README for first-time setup)
#   - Python 3.12 available locally
#
# Usage:
#   chmod +x infra/deploy-backend.sh
#   LAMBDA_FUNCTION_NAME=va-gmwb-api ./infra/deploy-backend.sh

set -euo pipefail

FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-va-gmwb-api}"
BACKEND_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
BUILD_DIR="$(mktemp -d)"
ZIP_FILE="$(mktemp).zip"

echo "==> Building Lambda package in $BUILD_DIR"
echo "    Function: $FUNCTION_NAME"

# Install dependencies into a flat package directory
pip install \
  --quiet \
  --platform manylinux2014_aarch64 \
  --target "$BUILD_DIR" \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  -r "$BACKEND_DIR/requirements.txt"

# Copy source code
cp -r "$BACKEND_DIR/engine"   "$BUILD_DIR/"
cp -r "$BACKEND_DIR/data"     "$BUILD_DIR/"
cp    "$BACKEND_DIR/main.py"  "$BUILD_DIR/"
cp    "$BACKEND_DIR/handler.py" "$BUILD_DIR/"

# Zip it up
echo "==> Zipping package"
(cd "$BUILD_DIR" && zip -qr "$ZIP_FILE" .)

echo "==> Uploading to Lambda ($FUNCTION_NAME)"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_FILE" \
  --architectures arm64

echo "==> Waiting for update to complete..."
aws lambda wait function-updated --function-name "$FUNCTION_NAME"

echo "==> Done. Function URL:"
aws lambda get-function-url-config \
  --function-name "$FUNCTION_NAME" \
  --query 'FunctionUrl' \
  --output text 2>/dev/null || echo "    (No function URL configured — set one in the Lambda console)"

# Cleanup
rm -rf "$BUILD_DIR" "$ZIP_FILE"
