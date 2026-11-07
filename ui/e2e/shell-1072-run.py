"""표본 연결과 sandbox를 띄워 shell-1072-review.py를 실행한다.

KS_1072_MOCK에는 로컬 표본 서버의 mock_run.py를 지정한다. 다른 입력은
shell-1072-review.py의 환경변수와 sandbox.py의 인자를 따른다.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer


mock_path = Path(os.environ["KS_1072_MOCK"]).resolve()
sys.path.insert(0, str(mock_path.parent))
spec = importlib.util.spec_from_file_location("shell_1072_mock", mock_path)
mock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mock)
server = ThreadingHTTPServer(("127.0.0.1", 0), mock.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="ks-1072-") as directory:
        bootstrap = Path(directory) / "bootstrap.json"
        bootstrap.write_text('{"id":"review-boot","name":"시험","requires":{"blocks":4,"modules":{}},"permissions":[],"state":{},"ui":{"type":"text","value":"시험"}}', encoding="utf-8")
        sandbox = Path(os.environ["AGENT_COMMON_FILES_DIR"]) / "skills/kaleidoscope-app/scripts/sandbox.py"
        scenario = Path(__file__).with_name("shell-1072-review.py").resolve()
        command = [sys.executable, str(sandbox), "run", "--app", str(bootstrap),
                   "--connection", f"xops=http://127.0.0.1:{server.server_address[1]}", "--scenario", str(scenario), *sys.argv[1:]]
        result = subprocess.run(command, timeout=560, check=False)
finally:
    server.shutdown()
sys.exit(result.returncode)
