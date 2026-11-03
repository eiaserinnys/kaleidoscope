"""실제 쉘에서 에이전트 선택, 로딩, 로그인 실패와 복구 화면을 확인한다."""
import functools
import importlib.util
import json
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
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)


def main():
    with tempfile.TemporaryDirectory(prefix='ks-agent-auth-') as directory:
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
            program = str(ROOT / 'target/debug/kaleidoscope-acp-test-agent')
            agents = [{'id':'fixture', 'name':'시험 에이전트', 'command':program, 'args':[], 'env':{'TEST_SCENARIO':'auth_fail_once_delay_start'}}]
            write = sb.mcp.call('write_app_storage', {'app_id':'agent','entry_id':'agents','content':agents})
            assert not write['is_error'], write['text']
            snapshot = sb.snapshot()
            workspace = snapshot['device']['active_workspace_id']
            desktop = snapshot['device']['active_desktop_ids'][workspace]
            opened = sb.core({'op':'window.open','desktop_id':desktop,'app_id':'agent','rect':{'x':20,'y':20,'width':620,'height':680}})
            assert 'window' in opened, opened
            window_id = opened['window']['id']
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1100, 800))
                page = sb.page
                http_failures = []
                stage = {'name':'시작'}
                def remember_failure(response):
                    if response.status == 400 and response.url.endswith('/core'):
                        try:
                            http_failures.append({'stage':stage['name'], 'op':response.request.post_data_json.get('op'), 'id':response.json().get('id')})
                        except Exception:
                            http_failures.append({'op':'확인 불가', 'id':'확인 불가'})
                page.on('response', remember_failure)
                app = sb.window('agent')
                app.get_by_role('button', name='폴더 선택', exact=True).wait_for(timeout=30000)
                capture(sb, app, '02-agent-one')
                app.get_by_role('button', name='폴더 선택', exact=True).click()
                dialog = app.get_by_role('dialog')
                dialog.wait_for(timeout=30000)
                dialog.get_by_role('button', name='허용', exact=True).click()
                app.locator('.ks-data-skeleton').first.wait_for(timeout=30000)
                capture(sb, app, '08-starting')
                login = app.get_by_role('button', name='로그인', exact=True)
                login.wait_for(timeout=30000)
                capture(sb, app, '09-login')
                stage['name'] = '로그인 실패와 재시도'
                login.click()
                app.get_by_text('AGENT_LOGIN_AUTHENTICATE_FAILED', exact=True).wait_for(timeout=30000)
                capture(sb, app, '10-login-failed')
                app.get_by_role('button', name='로그인', exact=True).click()
                box = app.get_by_role('textbox', name='메시지')
                box.wait_for(timeout=30000)
                stage['name'] = '응답 실패'
                box.fill('fail-turn')
                box.press('Enter')
                app.get_by_text('AGENT_ACP_PROTOCOL_FAILED', exact=True).wait_for(timeout=30000)
                capture(sb, app, '11-failed')
                stage['name'] = '세션 다시 시도'
                app.get_by_role('button', name='다시 시도', exact=True).click()
                app.get_by_role('button', name='로그인', exact=True).wait_for(timeout=30000)
                assert not app.get_by_role('dialog').count(), '같은 실행 허용을 다시 묻습니다'
                app.get_by_role('button', name='로그인', exact=True).click()
                app.get_by_text('AGENT_LOGIN_AUTHENTICATE_FAILED', exact=True).wait_for(timeout=30000)
                app.get_by_role('button', name='로그인', exact=True).click()
                box = app.get_by_role('textbox', name='메시지')
                box.wait_for(timeout=30000)
                stage['name'] = '대화 재개'
                app.get_by_text('OLD', exact=True).wait_for(timeout=30000)
                box.fill('fresh-turn')
                box.press('Enter')
                app.get_by_text('NEW', exact=True).wait_for(timeout=30000)
                stage['name'] = '창 닫기'
                sb.core({'op':'window.close', 'window_id':window_id})
                wait(lambda: sb.window_of('agent') is None, '로그인 시험 창이 닫히지 않았습니다')
                current = sb.mcp.call('read_app_storage', {'app_id':'agent','entry_id':'agents'})
                assert not current['is_error'], current['text']
                revision = current['data']['revision']
                empty = sb.mcp.call('write_app_storage', {'app_id':'agent','entry_id':'agents','content':[], 'expected_revision':revision})
                assert not empty['is_error'], empty['text']
                reopened = sb.core({'op':'window.open','desktop_id':desktop,'app_id':'agent','rect':{'x':20,'y':20,'width':620,'height':680}})
                assert 'window' in reopened, reopened
                app = sb.window('agent')
                app.get_by_text('등록된 에이전트가 없습니다', exact=True).wait_for(timeout=30000)
                capture(sb, app, '03-agent-empty')
                app.get_by_role('button', name='기본 목록으로 되돌리기').click()
                wait(lambda: app.locator('.ks-data-button:visible').count() >= 4, '기본 에이전트 목록이 복원되지 않았습니다')
                print('6 passed: 단일 에이전트, 시작, 로그인 실패와 재시도, 응답 실패와 기록 복원, 빈 목록 복원', flush=True)
                print('HTTP 오류:', http_failures, flush=True)
                browser.close()
        finally:
            print('브라우저 오류:', sb.console[-10:], flush=True)
            sb.stop()

if __name__ == '__main__':
    main()
