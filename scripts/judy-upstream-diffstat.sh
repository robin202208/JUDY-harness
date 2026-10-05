#!/usr/bin/env bash
# scripts/judy-upstream-diffstat.sh
#
# 用真实 diff 复核"哪些包被改了、改了多少"，替代哈希法的假阳性。
# 输出按改动行数降序排列，便于判断补丁成本集中在哪。
#
# 用法: bash judy-upstream-diffstat.sh <上游检出> <JUDY仓库> [topN]

set -uo pipefail

UP="${1:?用法: $0 <上游检出> <JUDY仓库> [topN]}"
JU="${2:?用法: $0 <上游检出> <JUDY仓库> [topN]}"
TOP="${3:-40}"

[ -d "$UP/packages" ] || { echo "错误: $UP/packages 不存在" >&2; exit 2; }
[ -d "$JU/packages" ] || { echo "错误: $JU/packages 不存在" >&2; exit 2; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# 遍历 JUDY 里的包；以 src 目录为比较单位
while IFS= read -r src; do
  rel="${src#"$JU/packages/"}"          # skill/skill/src
  pkg="${rel%/src}"                     # skill/skill
  upsrc="$UP/packages/$pkg/src"

  if [ ! -d "$upsrc" ]; then
    # 上游没有这个包（新增），或结构不同
    files=$(find "$src" -type f | wc -l | tr -d ' ')
    printf '%s\t%s\t%s\n' "999999" "$pkg" "本仓新增（上游无此包，$files 个文件）" >> "$tmp"
    continue
  fi

  n=$(diff -r -q "$upsrc" "$src" 2>/dev/null | grep -c '^')
  # 改动行数（更细的信号）
  lines=$(diff -r "$upsrc" "$src" 2>/dev/null | grep -c '^[<>]')

  if [ "$n" -eq 0 ]; then
    printf '%s\t%s\t%s\n' "0" "$pkg" "完全一致" >> "$tmp"
  else
    printf '%s\t%s\t%s\n' "$lines" "$pkg" "$n 个文件不同 / $lines 行变化" >> "$tmp"
  fi
done < <(find "$JU/packages" -maxdepth 3 -type d -name src | sort)

total=$(wc -l < "$tmp" | tr -d ' ')
same=$(awk -F'\t' '$1=="0"' "$tmp" | wc -l | tr -d ' ')
added=$(awk -F'\t' '$1=="999999"' "$tmp" | wc -l | tr -d ' ')
changed=$((total - same - added))

echo ""
echo "  JUDY ↔ 上游 逐包源码 diff（按改动行数）"
echo "  ─────────────────────────────────────────────"
echo "  可比包总数        $total"
echo "  完全一致          $same"
echo "  有改动            $changed"
echo "  本仓新增          $added"
echo ""

echo "  改动最多的 $TOP 个包："
echo ""
awk -F'\t' '$1!="0" && $1!="999999"' "$tmp" | sort -rn | head -"$TOP" | \
  awk -F'\t' '{ printf "    %-42s %s 行\n", $2, $1 }'
echo ""

echo "  本仓新增的包："
awk -F'\t' '$1=="999999"' "$tmp" | awk -F'\t' '{ printf "    %-42s %s\n", $2, $3 }'
echo ""
