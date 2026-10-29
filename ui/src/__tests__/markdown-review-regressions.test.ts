import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
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
it('닫는 괄호가 없는 링크는 원문으로 남는다', () => {
 const text='본문에 [안내 링크](X의 글자들이 있다.';
 const view=open(text); ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.querySelector('.ks-live-link')).toBeNull();
 expect(view.contentDOM.textContent).toContain(text);
});
it('큰 문서 뒤쪽 참조 정의를 스크롤 없이 반영한다', async () => {
 const text='[Text][id]\n\n'+'paragraph contents.\n\n'.repeat(18000)+'[id]: https://example.com\n';
 const view=open(text);
 await new Promise(resolve=>setTimeout(resolve,1800));
 expect(syntaxTree(view.state).length).toBeLessThan(view.state.doc.length);
 expect(view.contentDOM.querySelector('.ks-live-link')?.textContent).toBe('Text');
});
it('참조 정의를 바꾸고 지우면 링크 렌더가 즉시 따라간다', () => {
 const text='[Text][id]\n\n[id]: https://example.com';
 const view=open(text); ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.querySelector('.ks-live-link')?.textContent).toBe('Text');
 const definition=view.state.doc.line(3);
 view.dispatch({changes:{from:definition.from,to:definition.to,insert:'[other]: https://example.com'}});
 expect(view.contentDOM.querySelector('.ks-live-link')).toBeNull();
 view.dispatch({changes:{from:definition.from,to:definition.from+7,insert:'[id]'}});
 expect(view.contentDOM.querySelector('.ks-live-link')?.textContent).toBe('Text');
});
it('코드 블록에만 있는 참조 정의는 링크로 해석하지 않는다', () => {
 const text='[Text][id]\n\n```md\n[id]: https://example.com\n```';
 const view=open(text); ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.querySelector('.ks-live-link')).toBeNull();
 expect(view.contentDOM.textContent).toContain('[Text][id]');
});
it('정의 앞의 삽입과 삭제 뒤에도 같은 이름의 코드 줄과 실제 정의를 구별한다', () => {
 const text='[Text][id]\n\n```md\n[id]: https://code.example\n```\n\n[id]: https://real.example\n';
 const view=open(text); ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.querySelector('.ks-live-link')?.textContent).toBe('Text');
 view.dispatch({changes:{from:0,insert:'새 문장\n\n'}});
 let definition=view.state.doc.lineAt(view.state.sliceDoc().indexOf('[id]: https://real.example'));
 view.dispatch({changes:{from:definition.from,to:definition.to,insert:'[other]: https://real.example'}});
 ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.textContent).toContain('[Text][id]');
 view.dispatch({changes:{from:0,to:'새 문장\n\n'.length}});
 definition=view.state.doc.lineAt(view.state.sliceDoc().indexOf('[other]: https://real.example'));
 view.dispatch({changes:{from:definition.from,to:definition.from+7,insert:'[id]'}});
 ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.querySelector('.ks-live-link')?.textContent).toBe('Text');
});
it('참조 정의 줄은 렌더에서 비우고 선택하면 원문을 보인다', () => {
 const text='[Text][id]\n\n[id]: https://example.com\n';
 const view=open(text); ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.textContent).not.toContain('[id]: https://example.com');
 view.focus(); view.dispatch({selection:{anchor:view.state.doc.line(3).from}});
 expect(view.contentDOM.textContent).toContain('[id]: https://example.com');
});
it('들여쓴 코드의 공백은 렌더에서 대체하고 선택한 블록에서는 보인다', () => {
 const text='앞\n\n    코드 첫 줄\n    코드 둘째 줄\n\n뒤';
 const view=open(text); ensureSyntaxTree(view.state,view.state.doc.length,5000); view.dispatch({});
 expect(view.contentDOM.querySelector('.ks-live-code-indent')).toBeNull();
 const lines=view.contentDOM.querySelectorAll('.ks-live-code-block');
 expect(lines[0].textContent).toBe('코드 첫 줄');
 expect(lines[1].textContent).toBe('코드 둘째 줄');
 view.focus(); view.dispatch({selection:{anchor:view.state.doc.line(4).from+4}});
 expect(view.contentDOM.querySelectorAll('.ks-live-code-block')[0].textContent).toBe('    코드 첫 줄');
 expect(view.state.sliceDoc()).toBe(text);
});
