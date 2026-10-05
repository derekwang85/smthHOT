#!/usr/bin/env bash
# AIHOT / smthHOT 启动脚本
# 用途：加载 LLM key 环境变量 DSF0731 后拉起容器，避免 .env 里 ${DSF0731} 插值为空。
# 用法：bash up.sh             → 启动（不重建）
#       bash up.sh --build     → 重建镜像后启动
#       bash up.sh down        → 停止
set -euo pipefail
cd "$(dirname "$0")"

# 从 profile 提取 key（直接读文件，绕开 .bashrc 非交互 early-return）
export DSF0731="$(grep -m1 '^export DSF0731=' "$HOME/.bashrc" | sed 's/^export DSF0731="//; s/".*$//')"

if [ -z "${DSF0731:-}" ]; then
  echo "错误：未在 ~/.bashrc 找到 DSF0731 环境变量" >&2
  exit 1
fi

if [ "${1:-}" = "down" ]; then
  docker compose down
else
  docker compose up -d "$@"
fi
