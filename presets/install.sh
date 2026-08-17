#!/usr/bin/env bash
# JUDY 行业预设包一键安装脚本
# 用法：bash presets/install.sh
set -euo pipefail

# 与运行时一致地解析 DSH_HOME（可用环境变量覆盖）
: "${DSH_HOME:=${HOME}/.dsh}"
DEST="${DSH_HOME}/.agent-presets"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/industry"

echo "安装 JUDY 行业预设包 → ${DEST}"
mkdir -p "${DEST}"

count=0
for dir in "${SRC}"/*/; do
  id="$(basename "${dir}")"
  [ -f "${dir}/agent.cordis.yml" ] || continue
  if [ -e "${DEST}/${id}" ]; then
    mv "${DEST}/${id}" "${DEST}/${id}.bak.$(date +%s)"
    echo "  已备份旧版本 ${id}"
  fi
  cp -r "${dir}" "${DEST}/${id}"
  rm -rf "${DEST}/${id}/.git" 2>/dev/null || true
  echo "  ✓ 安装 ${id}"
  count=$((count+1))
done

echo ""
echo "完成：安装 ${count} 个行业预设。"
echo "刷新页面后，新建会话时在「预设」选择中即可选用。"
echo "自定义与删除：直接操作 ${DEST}/<id> 目录即可。"
