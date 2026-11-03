"""실제 쉘에서 서버를 바꿨다가 돌아온 뒤 에이전트 세션을 복원한다."""
import functools
import hashlib
import importlib.util
import json
import os
import secrets
import sys
import tempfile
import urllib.request
from pathlib import Path

import psutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ['SCRATCH_WORKSPACE_DIR']) / '.local/tmp/card933/agent-f'
spec = importlib.util.spec_from_file_location('agent_app_test', ROOT / 'ui/e2e/agent-app.py')
agent = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(agent)
sandbox, wait = agent.sandbox, agent.wait
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)


def stopped(pids):
    return all(not psutil.pid_exists(int(pid)) or psutil.Process(int(pid)).status() == psutil.STATUS_ZOMBIE for pid in pids)


def main():
    with tempfile.TemporaryDirectory(prefix='ks-agent-switch-') as directory:
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
            test_log = Path(directory) / 'acp.jsonl'
            pid_log = Path(directory) / 'pids'
            program = str(ROOT / 'target/debug/kaleidoscope-acp-test-agent')
            env = {'TEST_SCENARIO':'tree', 'TEST_LOG':str(test_log), 'TEST_PID_LOG':str(pid_log)}
            agents = [{'id':'fixture','name':'시험 에이전트','command':program,'args':[],'env':env}]
            written = sb.mcp.call('write_app_storage', {'app_id':'agent','entry_id':'agents','content':agents})
            assert not written['is_error'], written['text']
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
                def remember_failure(response):
                    if response.status != 400 or not response.url.endswith('/core'):
                        return
                    try:
                        request = response.request.post_data_json
                        problem = response.json()
                        http_failures.append({'op':request.get('op'), 'id':problem.get('id')})
                    except Exception:
                        http_failures.append({'op':'확인 불가', 'id':'확인 불가'})
                page.on('response', remember_failure)
                app = sb.window('agent')
                app.get_by_role('button', name='폴더 선택', exact=True).wait_for(timeout=30000)
                app.get_by_role('button', name='폴더 선택', exact=True).click()
                dialog = app.get_by_role('dialog')
                dialog.wait_for(timeout=30000)
                dialog.get_by_role('button', name='허용', exact=True).click()
                box = app.get_by_role('textbox', name='메시지')
                box.wait_for(timeout=30000)
                box.fill('slow')
                box.press('Enter')
                app.get_by_role('button', name='멈춤', exact=True).wait_for(timeout=30000)
                pids = wait(lambda: pid_log.read_text(encoding='utf-8').split() if pid_log.exists() else None,
                            '에이전트 PID가 기록되지 않았습니다')
                port = sandbox.free_port()
                url = f'http://127.0.0.1:{port}'
                token = secrets.token_hex(16)
                sb._spawn('server2', [str(ROOT / 'target/debug/kaleidoscope-orchestrator')],
                          KALEIDOSCOPE_DB_PATH=str(Path(directory) / 'other.db'),
                          KALEIDOSCOPE_BIND=f'127.0.0.1:{port}', KALEIDOSCOPE_MCP_TOKEN=token)
                wait(lambda: urllib.request.urlopen(url + '/api/health', timeout=2).status == 200,
                     '두 번째 로컬 서버가 준비되지 않았습니다')
                second = sandbox.Mcp(url + '/mcp', token)
                pairing = sb.core({'op':'link.start', 'server_url':url})
                assert pairing.get('user_code'), pairing
                approved = second.call('approve_device', {'code':pairing['user_code']})
                assert not approved['is_error'], approved['text']
                wait(lambda: sb.snapshot()['link']['state'] == 'connected' and sb.snapshot()['link']['server_url'] == url,
                     '두 번째 서버에 연결되지 않았습니다')
                wait(lambda: sb.window_of('agent') is None, '다른 서버에서 이전 창이 보입니다')
                assert all(psutil.pid_exists(int(pid)) for pid in pids)
                returned = sb.core({'op':'link.start', 'server_url':sb.server})
                assert 'error' not in returned, returned
                wait(lambda: sb.snapshot()['link']['state'] == 'connected' and sb.snapshot()['link']['server_url'] == sb.server,
                     '원래 서버로 돌아오지 못했습니다')
                app = sb.window('agent')
                app.get_by_role('button', name='멈춤', exact=True).wait_for(timeout=30000)
                assert not app.get_by_role('alert').count(), '서버 복귀 뒤 오류 안내가 남았습니다'
                assert pid_log.read_text(encoding='utf-8').split() == pids
                assert not app.get_by_role('dialog').count(), '같은 실행 허용을 다시 묻습니다'
                app.get_by_role('button', name='멈춤', exact=True).click()
                wait(lambda: len(pid_log.read_text(encoding='utf-8').split()) == 4,
                     '턴 종료 뒤 새 프로세스가 시작되지 않았습니다')
                def records():
                    return [json.loads(line) for line in test_log.read_text(encoding='utf-8').splitlines()]
                wait(lambda: any(item.get('method') == 'session/load' for item in records()),
                     '새 프로세스가 같은 세션을 불러오지 않았습니다')
                created = next(item for item in records() if item.get('method') == 'session/new')
                loaded = next(item for item in records() if item.get('method') == 'session/load')
                assert loaded['params']['sessionId'] == 'session-1'
                assert created['params']['mcpServers'][0]['url'] != loaded['params']['mcpServers'][0]['url']
                app.get_by_role('textbox', name='메시지').wait_for(timeout=30000)
                assert not app.get_by_role('alert').count(), '세션 복구 뒤 오류 안내가 남았습니다'
                new_pids = pid_log.read_text(encoding='utf-8').split()
                wait(lambda: stopped(pids), '이전 프로세스가 종료되지 않았습니다')
                window_hash = hashlib.sha256(window_id.encode()).hexdigest()
                window_roots = list((sb.tmp / 'core').rglob(window_hash))
                assert window_roots, '창별 기기 보관을 찾지 못했습니다'
                sb.core({'op':'window.close', 'window_id':window_id})
                wait(lambda: all(not root.exists() for root in window_roots), '창을 닫은 뒤 창 보관이 남았습니다')
                wait(lambda: stopped(new_pids), '창을 닫은 뒤 에이전트 프로세스가 남았습니다')
                print('3 passed: 서버 복귀 뒤 턴 종료와 세션 재연결, 갱신된 도구 주소, 창과 프로세스 및 저장 정리', flush=True)
                print('전환 중 HTTP 오류:', http_failures, flush=True)
                browser.close()
        finally:
            print('브라우저 오류:', sb.console[-10:], flush=True)
            sb.stop()

if __name__ == '__main__':
    main()
