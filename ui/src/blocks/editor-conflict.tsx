import { Button, Notice } from "../components/primitives";
import type { FileEditorSession } from "./file-editor-session";

export function EditorConflict({ session }: { session: FileEditorSession }) {
  return <Notice actions={[
    <Button key="reload" onClick={() => void session.reload()}>다시 불러오기</Button>,
    <Button key="overwrite" onClick={() => void session.overwrite()} variant="emphasis">덮어쓰기</Button>,
  ]} role="alert">디스크에서 바뀌었습니다</Notice>;
}
