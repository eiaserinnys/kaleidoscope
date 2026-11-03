"""설정 항목이 많을 때 실제 쉘에서 끝까지 살펴볼 수 있는지 확인한다."""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ['SCRATCH_WORKSPACE_DIR']) / '.local/tmp/card933/agent-f'
spec = importlib.util.spec_from_file_location('agent_app_test', ROOT / 'ui/e2e/agent-app.py')
agent = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(agent)
sandbox, wait, capture = agent.sandbox, agent.wait, agent.capture


def main():
    with tempfile.TemporaryDirectory(prefix='ks-agent-settings-') as directory:
        folder = Path(directory) / '작업폴더'
        folder.mkdir()
        sb = sandbox.Sandbox(ROOT, OUT, folder)
        spawn = sb._spawn
        def local_spawn(name, command, **env):
            if name in ('server', 'bridge'):
                command[0] = str(ROOT / 'target/debug' / Path(command[0]).name)
            return spawn(name, command, **env)
        sb._spawn = local_spawn
        try:
            sb.start()
            agents = [{'id':'fixture','name':'시험 에이전트','command':str(ROOT / 'target/debug/kaleidoscope-acp-test-agent'),
                       'args':[], 'env':{'TEST_SCENARIO':'many_controls'}}]
            written = sb.mcp.call('write_app_storage', {'app_id':'agent','entry_id':'agents','content':agents})
            assert not written['is_error'], written['text']
            snapshot = sb.snapshot()
            workspace = snapshot['device']['active_workspace_id']
            desktop = snapshot['device']['active_desktop_ids'][workspace]
            opened = sb.core({'op':'window.open','desktop_id':desktop,'app_id':'agent',
                              'rect':{'x':20,'y':20,'width':620,'height':680}})
            assert 'window' in opened, opened
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1100, 800))
                app = sb.window('agent')
                app.get_by_role('button', name='폴더 선택', exact=True).click(timeout=30000)
                app.get_by_role('dialog').get_by_role('button', name='허용', exact=True).click(timeout=30000)
                app.get_by_role('textbox', name='메시지').wait_for(timeout=30000)
                app.get_by_role('button', name='앱 설정').click()
                app.get_by_role('button', name='설정 항목 0', exact=True).wait_for(timeout=30000)
                assert app.get_by_role('switch').count() == 6
                capture(sb, app, '16-settings-long')
                scroll = app.locator('.ks-app-settings-scroll')
                assert scroll.evaluate('element => element.scrollHeight > element.clientHeight')
                app.get_by_text('작업 폴더', exact=True).scroll_into_view_if_needed()
                assert app.get_by_role('button', name='에이전트', exact=True).is_visible()
                assert app.locator('.ks-settings-custom .ks-data-button > .ks-button').is_visible()
                print('2 passed: 긴 설정 목록의 스크롤과 에이전트 및 작업 폴더 조작', flush=True)
                browser.close()
        finally:
            print('브라우저 오류:', sb.console[-10:], flush=True)
            sb.stop()


if __name__ == '__main__':
    main()
