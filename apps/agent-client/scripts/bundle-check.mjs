export function checkBundle(generated, saved, recorded, expected) {
  if (!Buffer.from(generated).equals(Buffer.from(saved)) || JSON.stringify(recorded) !== JSON.stringify(expected)) {
    throw new Error("에이전트 client 번들과 자산 목록이 일치하지 않습니다");
  }
}
