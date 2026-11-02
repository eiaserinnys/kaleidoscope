// 생성물이다. `cargo test -p kaleidoscope-contract`가 crates/contract/src/errors/shell.rs에서 만든다. 손으로 고치지 않는다.
import type { CoreError } from "./contract";

export const SHELL_THREAD_READ_INVALID = (args: { name: string }): CoreError => ({ id: "SHELL_THREAD_READ_INVALID", code: "invalid_request", message: `문서 ${args.name}의 thread.json 형식이 올바르지 않습니다. 파일을 고쳐 다시 저장하세요.`, details: [] });
export const SHELL_CALL_UNEXPECTED_FAILURE = (args: { reason: string }): CoreError => ({ id: "SHELL_CALL_UNEXPECTED_FAILURE", code: "io", message: `쉘에서 예상하지 못한 오류가 났습니다: ${args.reason}`, details: [] });
export const SHELL_IPC_OPERATION_HEADER_INVALID = (): CoreError => ({ id: "SHELL_IPC_OPERATION_HEADER_INVALID", code: "invalid_request", message: `쉘 이진 요청 종류를 읽지 못했습니다. 요청을 다시 보내세요.`, details: [] });
export const SHELL_IPC_WINDOW_HEADER_INVALID = (): CoreError => ({ id: "SHELL_IPC_WINDOW_HEADER_INVALID", code: "invalid_request", message: `쉘 이진 요청의 창 정보를 읽지 못했습니다. 요청을 다시 보내세요.`, details: [] });
export const SHELL_IPC_HANDLE_HEADER_INVALID = (): CoreError => ({ id: "SHELL_IPC_HANDLE_HEADER_INVALID", code: "invalid_request", message: `쉘 이진 요청의 대상 정보를 읽지 못했습니다. 요청을 다시 보내세요.`, details: [] });
export const SHELL_IPC_BODY_INVALID = (): CoreError => ({ id: "SHELL_IPC_BODY_INVALID", code: "invalid_request", message: `쉘 이진 요청의 본문이 올바른 형식이 아닙니다. 이진 데이터를 다시 보내세요.`, details: [] });
export const SHELL_IPC_EXPORT_OFFSET_INVALID = (): CoreError => ({ id: "SHELL_IPC_EXPORT_OFFSET_INVALID", code: "invalid_request", message: `파일 내보내기 위치 정보가 없거나 올바르지 않아 쓸 수 없습니다. 내보내기를 다시 시작하세요.`, details: [] });
export const SHELL_IPC_OPERATION_UNSUPPORTED = (): CoreError => ({ id: "SHELL_IPC_OPERATION_UNSUPPORTED", code: "invalid_request", message: `쉘에서 지원하지 않는 이진 작업입니다. 파일 읽기, 내보내기, HTTP 읽기 또는 Blob 저장을 사용하세요.`, details: [] });
export const SHELL_IPC_CORE_TASK_INTERRUPTED = (): CoreError => ({ id: "SHELL_IPC_CORE_TASK_INTERRUPTED", code: "io", message: `쉘 코어 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.`, details: [] });
export const SHELL_IPC_BYTES_TASK_INTERRUPTED = (): CoreError => ({ id: "SHELL_IPC_BYTES_TASK_INTERRUPTED", code: "io", message: `쉘 이진 작업이 중단되어 요청을 마치지 못했습니다. 다시 시도하세요.`, details: [] });
