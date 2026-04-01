#!/bin/bash
# OASIS Installer — 원하는 에이전트에 보안 규칙을 설치한다
# Usage: bash install.sh

set -e

OPENCLAW_DIR="$HOME/.openclaw"
OASIS_SOURCE="$(cd "$(dirname "$0")" && pwd)/OASIS.md"

echo ""
echo "🏝️  OASIS — OpenClaw Antidote for Suspicious Injection Signals"
echo "   에이전트에 Prompt Injection 방어 규칙을 설치합니다."
echo ""

# Check OASIS.md exists
if [ ! -f "$OASIS_SOURCE" ]; then
  echo "❌ OASIS.md 파일을 찾을 수 없습니다."
  echo "   이 스크립트는 OASIS.md와 같은 디렉토리에서 실행해야 합니다."
  exit 1
fi

# Find all agent workspaces
echo "📋 발견된 에이전트 워크스페이스:"
echo ""

WORKSPACES=()
i=1

for dir in "$OPENCLAW_DIR"/workspace-*/; do
  if [ -d "$dir" ]; then
    agent_name=$(basename "$dir" | sed 's/workspace-//')
    has_oasis=""
    if [ -f "$dir/OASIS.md" ]; then
      has_oasis=" (✅ OASIS 설치됨)"
    fi
    echo "  $i) $agent_name$has_oasis"
    WORKSPACES+=("$dir")
    i=$((i + 1))
  fi
done

# Default workspace
if [ -d "$OPENCLAW_DIR/workspace" ]; then
  has_oasis=""
  if [ -f "$OPENCLAW_DIR/workspace/OASIS.md" ]; then
    has_oasis=" (✅ OASIS 설치됨)"
  fi
  echo "  $i) main (기본 에이전트)$has_oasis"
  WORKSPACES+=("$OPENCLAW_DIR/workspace")
  i=$((i + 1))
fi

echo ""
echo "  a) 전체 에이전트에 설치"
echo "  q) 취소"
echo ""

read -p "설치할 에이전트 번호를 선택하세요: " choice

if [ "$choice" = "q" ]; then
  echo "취소되었습니다."
  exit 0
fi

install_oasis() {
  local target_dir="$1"
  local agent_name=$(basename "$target_dir" | sed 's/workspace-//')
  cp "$OASIS_SOURCE" "$target_dir/OASIS.md"
  echo "  ✅ $agent_name — OASIS.md 설치 완료"
}

if [ "$choice" = "a" ]; then
  echo ""
  echo "전체 에이전트에 설치 중..."
  for dir in "${WORKSPACES[@]}"; do
    install_oasis "$dir"
  done
else
  idx=$((choice - 1))
  if [ $idx -ge 0 ] && [ $idx -lt ${#WORKSPACES[@]} ]; then
    echo ""
    install_oasis "${WORKSPACES[$idx]}"
  else
    echo "❌ 잘못된 번호입니다."
    exit 1
  fi
fi

echo ""
echo "🏝️  OASIS 설치 완료!"
echo ""
echo "   에이전트가 이제 실행 도구 사용 전 위험도 분석을 수행합니다."
echo "   OpenClaw gateway를 재시작하세요:"
echo ""
echo "   openclaw gateway restart"
echo ""
