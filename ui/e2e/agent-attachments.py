"""실제 쉘에서 첨부와 같이 보는 내용을 ACP 전송까지 확인한다."""
import base64
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ['SCRATCH_WORKSPACE_DIR']) / '.local/tmp/card933/agent-f'
spec = importlib.util.spec_from_file_location('agent_app_test', ROOT / 'ui/e2e/agent-app.py')
agent = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(agent)
sandbox, wait = agent.sandbox, agent.wait


def main():
    with tempfile.TemporaryDirectory(prefix='ks-agent-content-') as directory:
        folder = Path(directory) / '작업폴더'
        folder.mkdir()
        marker = '같이 보기 고유 표식 4932'
        (folder / '공유.md').write_text('# 같이 볼 문서\n\n' + marker, encoding='utf-8')
        sb = sandbox.Sandbox(ROOT, OUT, folder)
        spawn = sb._spawn
        def local_spawn(name, command, **env):
            if name in ('server', 'bridge'):
                command[0] = str(ROOT / 'target/debug' / Path(command[0]).name)
            return spawn(name, command, **env)
        sb._spawn = local_spawn
        try:
            sb.start()
            test_log = Path(directory) / 'acp.jsonl'
            program = str(ROOT / 'target/debug/kaleidoscope-acp-test-agent')
            agents = [{'id':'fixture', 'name':'시험 에이전트', 'command':program,
                       'args':[], 'env':{'TEST_LOG':str(test_log)}}]
            written = sb.mcp.call('write_app_storage', {'app_id':'agent','entry_id':'agents','content':agents})
            assert not written['is_error'], written['text']
            snapshot = sb.snapshot()
            workspace = snapshot['device']['active_workspace_id']
            desktop = snapshot['device']['active_desktop_ids'][workspace]
            opened = sb.core({'op':'window.open','desktop_id':desktop,'app_id':'agent',
                              'rect':{'x':20,'y':20,'width':620,'height':680}})
            assert 'window' in opened, opened
            document = sb.core({'op':'window.open','desktop_id':desktop,'app_id':'md-editor',
                                'rect':{'x':700,'y':20,'width':620,'height':680}})
            assert 'window' in document, document
            grant = sb.core({'op':'files.pick_folder','window_id':document['window']['id'],'permission':'docs'})
            assert 'error' not in grant, grant
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 800))
                page = sb.page
                editor = sb.window('md-editor')
                editor.get_by_role('tab', name='내 폴더').click()
                editor.get_by_role('treeitem', name='공유.md').click(timeout=30000)
                editor.get_by_text(marker, exact=True).first.wait_for(timeout=30000)
                editor.get_by_role('button', name='같이 보기', exact=True).click()
                editor.get_by_role('button', name='같이 보기 끄기', exact=True).wait_for(timeout=30000)
                app = sb.window('agent')
                app.get_by_role('button', name='폴더 선택', exact=True).click(timeout=30000)
                app.get_by_role('dialog').get_by_role('button', name='허용', exact=True).click(timeout=30000)
                box = app.get_by_role('textbox', name='메시지')
                box.wait_for(timeout=30000)
                wait(lambda: document['window']['id'] in sb.snapshot()['sharing'], '같이 보기가 켜지지 않았습니다')
                image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+l3ioAAAAASUVORK5CYII=')
                note = '파일 내용 5821'.encode('utf-8')
                app.locator('input[type=file]').set_input_files([
                    {'name':'그림.png','mimeType':'image/png','buffer':image},
                    {'name':'메모.txt','mimeType':'text/plain','buffer':note},
                ])
                app.get_by_text('메모.txt', exact=True).wait_for(timeout=30000)
                box.fill('첨부 검사')
                box.press('Enter')
                def prompts():
                    if not test_log.exists():
                        return []
                    return [item for line in test_log.read_text(encoding='utf-8').splitlines()
                            if (item := json.loads(line)).get('method') == 'session/prompt']
                first = wait(lambda: prompts()[0] if prompts() else None, '첨부한 첫 말이 전송되지 않았습니다')
                contents = first['params']['prompt']
                assert any(block.get('type') == 'text' and marker in block.get('text', '') for block in contents)
                assert any(block.get('type') == 'image' and block.get('mimeType') == 'image/png'
                           and base64.b64decode(block['data']) == image for block in contents)
                link = next(block for block in contents if block.get('type') == 'resource_link' and block.get('name') == '메모.txt')
                uri = urlsplit(link['uri'])
                assert uri.scheme == 'file'
                assert Path(unquote(uri.path)).read_bytes() == note
                app.get_by_text('안녕', exact=True).wait_for(timeout=30000)
                box.fill('다음 검사')
                box.press('Enter')
                second = wait(lambda: prompts()[1] if len(prompts()) >= 2 else None, '두 번째 말이 전송되지 않았습니다')
                assert all(marker not in block.get('text', '') for block in second['params']['prompt'])
                page.screenshot(path=str(OUT / 'attachments-and-context.png'))
                print('4 passed: 이미지 본문, 파일 주소와 내용, 같이 보기 전달, 다음 말에 중복 전달하지 않음', flush=True)
                browser.close()
        finally:
            print('브라우저 오류:', sb.console[-10:], flush=True)
            sb.stop()


if __name__ == '__main__':
    main()
