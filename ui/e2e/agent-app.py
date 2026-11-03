import functools
import importlib.util
import json
import os
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ['SCRATCH_WORKSPACE_DIR']) / '.local/tmp/card933/agent-f/r2'
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('sandbox', Path(os.environ['AGENT_COMMON_FILES_DIR']) / 'skills/kaleidoscope-app/scripts/sandbox.py')
sandbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sandbox)
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)

def wait(fn, message, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            result = fn()
            if result:
                return result
        except Exception:
            pass
        time.sleep(0.1)
    raise AssertionError(message)

def capture(sb, app, name):
    for label, width, height, scheme in [('wide', 620, 680, 'light'),
                                         ('narrow', 360, 240, 'light'),
                                         ('wide--dark', 620, 680, 'dark')]:
        response = sb.core({'op':'window.set_rect', 'window_id':sb.window_of('agent')['id'],
                            'rect':{'x':20, 'y':20, 'width':width, 'height':height}})
        assert 'error' not in response, response
        sb.page.emulate_media(color_scheme=scheme)
        sb.page.mouse.move(1000, 750)
        sb.page.wait_for_timeout(150)
        app.screenshot(path=str(OUT / f'{name}--{label}.png'))
    sb.page.emulate_media(color_scheme='light')
    sb.core({'op':'window.set_rect', 'window_id':sb.window_of('agent')['id'],
             'rect':{'x':20, 'y':20, 'width':620, 'height':680}})

def main():
    with tempfile.TemporaryDirectory(prefix='ks-agent-f-') as directory:
        folder = Path(directory) / '작업폴더'
        folder.mkdir()
        sb = sandbox.Sandbox(ROOT, OUT, folder)
        spawn = sb._spawn
        def local_spawn(name, command, **env):
            if name in ('server', 'bridge'):
                command[0] = str(ROOT / 'target/debug' / Path(command[0]).name)
            return spawn(name, command, **env)
        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            test_log = str(Path(directory) / 'acp.jsonl')
            pid_log = str(Path(directory) / 'pids')
            program = str(ROOT / 'target/debug/kaleidoscope-acp-test-agent')
            env = {'TEST_SCENARIO': 'tree', 'TEST_LOG': test_log, 'TEST_PID_LOG': pid_log}
            agents = [{'id':f'fixture{index}','name':name,'command':program,'args':[],'env':env}
                      for index, name in enumerate(['에이전트 하나','에이전트 둘','에이전트 셋','에이전트 넷'])]
            result = sb.mcp.call('write_app_storage', {'app_id':'agent','entry_id':'agents','content':agents})
            assert not result['is_error'], result['text']
            snapshot = sb.snapshot()
            workspace = snapshot['device']['active_workspace_id']
            desktop = snapshot['device']['active_desktop_ids'][workspace]
            opened = sb.core({'op':'window.open','desktop_id':desktop,'app_id':'agent','rect':{'x':20,'y':20,'width':620,'height':680}})
            assert 'window' in opened, opened
            window_id = opened['window']['id']
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1100, 800))
                page = sb.page
                app = sb.window('agent')
                app.get_by_role('button', name='에이전트 하나', exact=True).wait_for(timeout=30000)
                capture(sb, app, '01-agent-four')
                app.get_by_role('button', name='에이전트 하나', exact=True).click()
                app.get_by_role('button', name='폴더 선택', exact=True).wait_for()
                assert app.locator('.ks-window-title').inner_text() == '에이전트'
                capture(sb, app, '06-folder')
                app.get_by_role('button', name='폴더 선택', exact=True).click()
                dialog = app.get_by_role('dialog')
                dialog.wait_for(timeout=30000)
                sb.core({'op':'window.set_rect','window_id':window_id,'rect':{'x':20,'y':20,'width':360,'height':240}})
                command = dialog.locator('.ks-process-command')
                assert command.evaluate('element => element.scrollWidth <= element.clientWidth')
                assert command.evaluate('element => element.parentElement.scrollWidth <= element.parentElement.clientWidth')
                sb.core({'op':'window.set_rect','window_id':window_id,'rect':{'x':20,'y':20,'width':620,'height':680}})
                dialog.get_by_role('button', name='허용', exact=True).click()
                app.get_by_role('textbox', name='메시지').wait_for(timeout=30000)
                assert app.locator('.ks-window-title').inner_text() == '에이전트 하나'
                capture(sb, app, '12-chat')
                box = app.get_by_role('textbox', name='메시지')
                box.fill('fail-turn')
                box.press('Enter')
                app.get_by_text('OLD', exact=True).wait_for(timeout=30000)
                app.get_by_role('alert').get_by_text('에이전트 응답을 받지 못했습니다.', exact=False).wait_for(timeout=30000)
                assert app.get_by_role('textbox', name='메시지').is_visible()
                box.fill('fresh-turn')
                box.press('Enter')
                app.get_by_text('NEW', exact=True).wait_for(timeout=30000)
                app.get_by_role('button', name='앱 설정').click()
                app.get_by_role('heading', name='앱 설정').wait_for()
                app.get_by_role('button', name='모드', exact=True).wait_for()
                capture(sb, app, '14-settings')
                print('settings text:', app.locator('.ks-settings-custom').inner_text(), flush=True)
                app.get_by_role('button', name='앱으로 돌아가기').click()
                box = app.get_by_role('textbox', name='메시지')
                box.fill('permission')
                box.press('Enter')
                app.get_by_text('파일 수정', exact=True).wait_for(timeout=30000)
                capture(sb, app, '13-chat-responding')
                app.get_by_role('button', name='앱 설정').click()
                app.get_by_text('응답이 끝나면 바꿀 수 있습니다', exact=True).wait_for()
                assert app.get_by_role('button', name='모드', exact=True).is_disabled()
                assert app.get_by_role('switch', name='토글', exact=True).is_disabled()
                assert app.get_by_role('button', name='에이전트', exact=True).is_disabled()
                assert app.locator('.ks-settings-custom .ks-data-button > .ks-button').is_disabled()
                capture(sb, app, '15-settings-locked')
                app.get_by_role('button', name='앱으로 돌아가기').click()
                pids = Path(pid_log).read_text(encoding='utf-8').split()
                page.reload(wait_until='domcontentloaded')
                app = sb.window('agent')
                app.get_by_text('파일 수정', exact=True).wait_for(timeout=30000)
                app.get_by_role('button', name='허용', exact=True).click()
                app.get_by_text('선택: yes', exact=True).wait_for(timeout=30000)
                assert Path(pid_log).read_text(encoding='utf-8').split() == pids
                records = [json.loads(line) for line in Path(test_log).read_text(encoding='utf-8').splitlines()]
                assert sum(item.get('method') == 'session/prompt' for item in records) == 3
                box = app.get_by_role('textbox', name='메시지')
                box.fill('stream')
                box.press('Enter')
                wait(lambda: '[00]' in app.locator('.ks-agent-chat-assistant').last.inner_text(), '스트리밍이 시작되지 않았습니다')
                assert app.get_by_role('button', name='멈춤', exact=True).is_visible()
                page.reload(wait_until='domcontentloaded')
                app = sb.window('agent')
                app.get_by_role('textbox', name='메시지').wait_for(timeout=30000)
                assert app.get_by_role('button', name='멈춤', exact=True).is_visible()
                assert Path(pid_log).read_text(encoding='utf-8').split() == pids
                box = app.get_by_role('textbox', name='메시지')
                box.fill('fresh-turn')
                box.press('Enter')
                expected = ''.join(f'[{index:02d}]' for index in range(80))
                wait(lambda: any(expected in item for item in app.locator('.ks-agent-chat-assistant').all_inner_texts()), '스트리밍 답변이 빠지거나 중복됐습니다')
                wait(lambda: app.get_by_text('NEW', exact=True).count() == 2, '대기한 다음 응답이 오지 않았습니다')
                records = [json.loads(line) for line in Path(test_log).read_text(encoding='utf-8').splitlines()]
                assert sum(item.get('method') == 'session/prompt' for item in records) == 5
                assert Path(pid_log).read_text(encoding='utf-8').split() == pids
                print('7 passed: 선택과 폴더, 실행 허용, 한 턴 실패 후 대화, 설정, 승인과 스트리밍 중 실제 리로드, 큐와 중복 없는 전송', flush=True)
                print('pids:', pids, 'console:', sb.console[-10:], flush=True)
                browser.close()
                browser = None
        finally:
            try:
                if browser:
                    print('console:', sb.console[-15:], 'logs:', sb.tmp, flush=True)
                    try:
                        browser.close()
                    except Exception:
                        pass
            finally:
                sb.stop()

if __name__ == '__main__':
    main()
