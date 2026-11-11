#!/usr/bin/env bash
# ui/e2e를 전용 네트워크 네임스페이스에서 돌린다(카드 #1138).
# 호스트에서 컨테이너가 뜨고 질 때 veth에 주소가 붙고 떨어지면 Chromium이 이를 IP 변경으로 받아
# 받던 모듈 요청을 ERR_NETWORK_CHANGED로 끊는다. 네임스페이스 안에는 lo만 있어 그 변경이 보이지 않는다.
# 하니스 서버(webServer)와 Chromium은 playwright의 자식이라 같은 네임스페이스에서 돈다.
# 쓰는 법: corepack pnpm@10.32.1 --dir ui e2e:netns --shard=1/4   (인자는 그대로 playwright test로 간다)
set -euo pipefail
ui_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec unshare --user --map-root-user --net -- bash -c 'ip link set lo up && cd "$0" && exec ./node_modules/.bin/playwright test "$@"' "$ui_dir" "$@"
