// 생성물이다. `cargo test -p kaleidoscope-contract`가 crates/contract/src/errors/shell.rs에서 만든다. 손으로 고치지 않는다.
import type { CoreError } from "./contract";

export const SHELL_CALL_UNEXPECTED_FAILURE = (args: { reason: string }): CoreError => ({ id: "SHELL_CALL_UNEXPECTED_FAILURE", code: "io", message: `쉘에서 예상하지 못한 오류가 났습니다: ${args.reason}`, details: [] });
