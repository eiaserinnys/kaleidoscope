import type { ConversationItem } from "../src/contract/contract";

const timestamp = "2026-10-28T00:00:00Z";
const paragraph = "회의 내용을 정리하고 필요한 다음 행동을 확인합니다. 각 담당자는 변경된 부분을 살펴보고 근거가 되는 기록을 남깁니다. ".repeat(3);
const list = `검토할 항목은 다음과 같습니다.\n\n- 연결된 화면의 상태를 확인합니다.\n- 실제로 보이는 결과와 기록을 비교합니다.\n- 변경이 필요한 부분을 정리합니다.\n\n\`selected_model\` 값은 작업마다 따로 저장됩니다.\n\n${"작업이 끝나면 변경 내용을 확인하고 다음 단계로 넘어갑니다. ".repeat(8)}`;
const tableAndCode = `| 항목 | 상태 | 다음 단계 |\n| --- | --- | --- |\n| 입력 | 확인 중 | 글자를 기록 |\n| 응답 | 진행 중 | 내용을 비교 |\n| 결과 | 대기 | 저장 확인 |\n\n\`\`\`ts\nconst workspace = "kaleidoscope";\nconst ready = workspace.length > 0;\nconsole.log(ready);\n\`\`\`\n\n${"기록을 읽고 필요한 변화만 반영합니다. ".repeat(94)}`;

const answers = [
  paragraph.padEnd(300, "설"),
  list.padEnd(1200, "다"),
  tableAndCode.padEnd(4000, "음"),
];

export function makeLongConversation(count: number): ConversationItem[] {
  return Array.from({ length: count }, (_, index) => {
    const assistant = index % 2 === 1;
    return {
      id: `long-history-${index}`,
      kind: assistant ? "assistant" : "user",
      text: assistant ? answers[Math.floor(index / 2) % answers.length] : `대화 ${index + 1}번째 기록입니다. ${"요청 내용을 확인하고 다음 작업을 정리합니다. ".repeat(2)}`,
      at: timestamp,
      attachments: [],
    } satisfies ConversationItem;
  });
}
