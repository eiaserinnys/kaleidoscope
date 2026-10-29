import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createMarkdownEditorState } from '../blocks/markdown-editor-state';
const views: EditorView[] = [];
beforeEach(() => Object.defineProperty(Range.prototype, 'getClientRects', {configurable:true, value:()=>[]}));
afterEach(() => { for (const view of views) view.destroy(); views.length=0; document.body.innerHTML=''; });
function open(text:string) {
 const host=document.createElement('div'); document.body.append(host);
 const view=new EditorView({state:createMarkdownEditorState(text),parent:host}); views.push(view); return view;
}
it('여러 줄 이미지도 편집기를 열 수 있다', () => {
 const text='before\n\n![first\nsecond](image.png)\n\nafter';
 expect(()=>open(text)).not.toThrow();
});
it('여러 줄 링크 제목도 편집기를 열 수 있다', () => {
 const text='before\n\n[label](https://example.com\n "title")\n\nafter';
 expect(()=>open(text)).not.toThrow();
});
it('여러 줄 강조의 선택 줄에서는 닫는 원문 기호가 보인다', () => {
 const view=open('**first\nsecond**\n\nafter');
 view.focus(); view.dispatch({selection:{anchor:view.state.doc.line(2).from+2}});
 expect(view.contentDOM.textContent).toContain('second**');
});
