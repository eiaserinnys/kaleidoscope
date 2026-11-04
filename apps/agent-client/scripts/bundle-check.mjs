import { createHash } from "node:crypto";

export function checkBundle(generated, saved, recorded, expected) {
  if (!Buffer.from(generated).equals(Buffer.from(saved)) || JSON.stringify(recorded) !== JSON.stringify(expected)) {
    throw new Error("에이전트 client 번들과 자산 목록이 일치하지 않습니다");
  }
}

export function checkPreserved(saved, recorded, expected) {
  const sha256 = createHash("sha256").update(saved).digest("hex");
  if (sha256 !== expected.sha256 || saved.length !== expected.byte_size || JSON.stringify(recorded) !== JSON.stringify(expected)) {
    throw new Error("에이전트 client 보존 자산이나 목록이 변경되었습니다");
  }
}
