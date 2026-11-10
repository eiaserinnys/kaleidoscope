import type { ReactNode } from "react";
import type { CoreError } from "../../contract/contract";
import { ErrorId } from "../primitives";
import { TextInput, type TextInputCancelReason } from "../text-input";

/** 폴더 트리와 데이터 트리가 함께 쓰는 바로 입력 글칸. 배치와 여백은 폴더 트리의 바로 입력 행을 그대로 따른다. */
export function TreeEditInput({ inputKey, ariaLabel, value, focusReturn, cancelOnBlur = false, cancelOnEscape = false, commitOnBlur = true, selectBeforeExtension = false, onCommit, onCancel }: {
  inputKey?: string;
  ariaLabel: string;
  value: string;
  /** 글칸이 사라졌을 때 초점을 되돌릴 조작을 가리키는 표시. window-focus의 같은 자리 규칙이 읽는다. */
  focusReturn?: string;
  cancelOnBlur?: boolean;
  cancelOnEscape?: boolean;
  commitOnBlur?: boolean;
  selectBeforeExtension?: boolean;
  onCommit: (value: string) => void;
  onCancel: (reason?: TextInputCancelReason) => void;
}) {
  return <TextInput
    key={inputKey}
    aria-label={ariaLabel}
    data-focus-return={focusReturn}
    cancelOnBlur={cancelOnBlur}
    cancelOnEscape={cancelOnEscape}
    commitOnBlur={commitOnBlur}
    onCancel={onCancel}
    onCommit={onCommit}
    selectBeforeExtension={selectBeforeExtension}
    value={value}
  />;
}

/** 바로 입력 행의 틀. 표식 열(들) 다음에 글칸을 두고, 실패가 있으면 행 아래에 알림 줄을 둔다. */
export function TreeEditRow({ ariaLabel, value, columns, error, inputKey, cancelOnBlur, cancelOnEscape, commitOnBlur, selectBeforeExtension, onCommit, onCancel }: {
  ariaLabel: string;
  value: string;
  columns: ReactNode[];
  error?: CoreError | null;
  inputKey?: string;
  cancelOnBlur?: boolean;
  cancelOnEscape?: boolean;
  commitOnBlur?: boolean;
  selectBeforeExtension?: boolean;
  onCommit: (value: string) => void;
  onCancel: (reason?: TextInputCancelReason) => void;
}) {
  return <div className="ks-file-tree-entry">
    <div className="ks-row ks-file-tree-row ks-file-tree-create-row">
      {columns.map((column, index) => <span aria-hidden="true" className="ks-file-tree-icon" key={index}>{column}</span>)}
      <TreeEditInput
        inputKey={inputKey}
        ariaLabel={ariaLabel}
        value={value}
        cancelOnBlur={cancelOnBlur}
        cancelOnEscape={cancelOnEscape}
        commitOnBlur={commitOnBlur}
        selectBeforeExtension={selectBeforeExtension}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
    {error ? <span className="ks-inline-error" role="alert">{error.message}{error.id ? <> <ErrorId id={error.id} /></> : null}</span> : null}
  </div>;
}
