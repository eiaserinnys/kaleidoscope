// 카드 #1136 B2 시험용 클라이언트. 준비 신호(ks-sandbox-ready)는 주입된 다리(bridge)가
// DOMContentLoaded에서 보내므로, 이 스크립트는 준비 전 로딩 표시가 사라지는 조건만 만든다.
document.body.textContent = '준비됨';
