#!/bin/bash
# 前后端编译并部署到生产环境的脚本
# 用法: ./deploy-frontend.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKEND_STATIC_DIR="$BACKEND_DIR/dist/static"

echo "=== 全栈部署脚本 ==="
echo "项目目录: $PROJECT_DIR"

# 1. 进入前端目录并编译
echo ""
echo "步骤1: 编译前端..."
cd "$FRONTEND_DIR"
npm run build

# 2. 编译后端（包含前端文件复制）
echo ""
echo "步骤2: 编译后端..."
cd "$BACKEND_DIR"
npm run build

echo ""
echo "步骤3: 重启 pm2 服务..."
pm2 restart "$PROJECT_DIR/ecosystem.config.js"

echo ""
echo "=== 部署完成 ==="
echo "请刷新 http://localhost:8081 查看效果"
