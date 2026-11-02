// 생성물이다. `cargo test -p kaleidoscope-contract`가 crates/contract/src/errors/shell.rs에서 만든다. 손으로 고치지 않는다.
import type { CoreError } from "./contract";

export const SHELL_THREAD_READ_INVALID = (args: { name: string }): CoreError => ({ id: "SHELL_THREAD_READ_INVALID", code: "invalid_request", message: `문서 ${args.name}의 thread.json 형식이 올바르지 않습니다. 파일을 고쳐 다시 저장하세요.`, details: [] });
export const SHELL_CALL_UNEXPECTED_FAILURE = (args: { reason: string }): CoreError => ({ id: "SHELL_CALL_UNEXPECTED_FAILURE", code: "io", message: `쉘에서 예상하지 못한 오류가 났습니다: ${args.reason}`, details: [] });
