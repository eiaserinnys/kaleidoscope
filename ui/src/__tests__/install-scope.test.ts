import { describe, expect, it } from "vitest";
import type { AppDefinition, PermissionDecl } from "../contract/contract";
import { describeInstallScope } from "../../../app/src/shell/install-scope";

const base = { id: "sample", name: "자료", requires: { blocks: 1, modules: {} }, state: {}, ui: { type: "text", value: "자료" }, permissions: [] } as AppDefinition;
const client = { runtime: "javascript", entry: { id: "view", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [] } as NonNullable<AppDefinition["client"]>;
const http = (id: string, host: string, label: string, paths: string[]): PermissionDecl => ({ module: "http", id, label, base_url: `https://${host}/`, paths });

describe("설치 권한 설명", () => {
  it("기본 폴더 종류와 접근 범위마다 설치 동의를 나눈다", () => {
    const permissions: PermissionDecl[] = [
      { module: "files", id: "p", label: "사진", access: "read", default_folder: "pictures" },
      { module: "files", id: "d", label: "문서", access: "readwrite", default_folder: "documents" },
      { module: "files", id: "f", label: "기타", access: "read" },
      { module: "store", id: "store", label: "스토어" },
      { module: "profiler", id: "perf", label: "측정" },
    ];
    const groups = describeInstallScope({ ...base, permissions }, "unknown");
    expect(groups.map((item) => item.sentence)).toEqual([
      "내가 고른 폴더의 파일을 읽습니다",
      "사진 폴더나 내가 고른 폴더의 파일을 읽습니다",
      "문서 폴더나 내가 고른 폴더의 파일을 읽고 고칩니다",
      "스토어에서 앱을 설치하고 지웁니다",
      "이 기기에서 쉘의 성능을 재고 기록을 봅니다",
    ]);
    expect(groups.find((item) => item.sentence.includes("사진 폴더"))?.notes).toEqual([]);
  });
  it("권한이 없는 클라이언트는 창 밖에 닿지 않는다", () => {
    expect(describeInstallScope({ ...base, client }, "unknown")).toEqual([]);
  });

  it("같은 사이트의 열두 경로는 한 행과 접힌 상세로 묶는다", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/path-${i}`);
    const groups = describeInstallScope({ ...base, permissions: [http("web", "example.org", "언어 자료", paths)] }, "unknown");
    expect(groups).toEqual([{ tone: "normal", sentence: "인터넷에서 자료를 받아옵니다", rows: [{ target: "example.org", reason: "언어 자료" }], notes: [], details: { label: "자세히", hosts: [{ host: "example.org", paths }] } }]);
  });

  it("사이트별로 묶고 같은 사이트의 이름표는 선언 순서대로 중복 없이 모은다", () => {
    const permissions = [http("a", "a.example", "첫째", ["/a"]), http("b", "b.example", "둘째", ["/b"]), http("c", "c.example", "셋째", ["/c"]), http("d", "d.example", "넷째", ["/d"]), http("e", "a.example", "다른 이유", ["/e", "/a"]), http("f", "a.example", "첫째", ["/f"])];
    const [group] = describeInstallScope({ ...base, permissions }, "unknown");
    expect(group.rows).toEqual([{ target: "a.example", reason: "첫째, 다른 이유" }, { target: "b.example", reason: "둘째" }, { target: "c.example", reason: "셋째" }, { target: "d.example", reason: "넷째" }]);
    expect(group.details).toEqual({ label: "자세히", hosts: [{ host: "a.example", paths: ["/a", "/e", "/f"] }, { host: "b.example", paths: ["/b"] }, { host: "c.example", paths: ["/c"] }, { host: "d.example", paths: ["/d"] }] });
  });

  it("실행 경고가 폴더 권한보다 먼저이며 프로그램의 선언 순서를 지킨다", () => {
    const permissions: PermissionDecl[] = [
      { module: "files", id: "folder", label: "문서", access: "readwrite" },
      { module: "process", id: "one", label: "변환", command: "tool-a" },
      { module: "process", id: "two", label: "설치", command: "tool-b" },
      { module: "process", id: "three", label: "기타" },
      { module: "process", id: "four", label: "추가" },
    ];
    const groups = describeInstallScope({ ...base, permissions }, "unknown");
    expect(groups.map((g) => g.sentence)).toEqual(["이 PC에서 프로그램을 실행합니다", "내가 고른 폴더의 파일을 읽고 고칩니다"]);
    expect(groups[0]).toMatchObject({ tone: "warning", rows: [{ target: "tool-a", reason: "변환" }, { target: "tool-b", reason: "설치" }, { reason: "기타" }, { reason: "추가" }], notes: ["실행할 프로그램은 그때마다 묻습니다", "실행한 프로그램은 내 계정 권한으로 파일과 인터넷에 닿습니다"] });
  });

  it("모든 권한 종류와 외부 기능을 빠짐없이 정해진 순서로 보인다", () => {
    const permissions: PermissionDecl[] = [
      { module: "profiler", id: "perf", label: "측정" }, { module: "store", id: "store", label: "앱 관리" },
      http("http", "example.org", "인터넷", ["/data"]),
      { module: "connection", id: "cw", label: "서비스 쓰기", connection: "service-w", access: "readwrite" },
      { module: "connection", id: "cr", label: "서비스 읽기", connection: "service-r", access: "read" },
      { module: "files", id: "pc", label: "내 PC", scope: "pc", access: "read" },
      { module: "files", id: "fw", label: "폴더 쓰기", scope: "folder", access: "readwrite" },
      { module: "files", id: "fr", label: "폴더 읽기", access: "read" },
      { module: "process", id: "proc", label: "변환", command: "convert" },
    ];
    const definition = { ...base, permissions, client: { ...client, capabilities: ["share", "instructions", "receive_message", "context_capture", "keep_awake"] }, worker: { runtime: "python3", code: "print('ok')", schedule: { interval_secs: 3661, enabled_entry: "settings" }, webhook: { token_secret: "token" }, calls: ["first", "second"], secrets: [{ id: "secret" }] }, storage: { entries: [] }, agent: { permission: "cr" } } as unknown as AppDefinition;
    const groups = describeInstallScope(definition, "remote", "server.example");
    expect(groups.map((g) => g.sentence)).toEqual([
      "이 PC에서 프로그램을 실행합니다", "server.example 서버에서 앱의 Python 코드를 실행합니다",
      "내가 고른 폴더의 파일을 읽습니다", "내가 고른 폴더의 파일을 읽고 고칩니다", "이 PC의 파일을 둘러보고 읽습니다",
      "연결한 서비스의 자료를 읽습니다", "연결한 서비스의 자료를 읽고 고칩니다", "인터넷에서 자료를 받아옵니다",
      "같이 보기를 켠 창의 화면과 글을 읽습니다", "스토어에서 앱을 설치하고 지웁니다", "이 기기에서 쉘의 성능을 재고 기록을 봅니다", "화면이 꺼지지 않게 합니다",
    ]);
    expect(groups[1]).toEqual({ tone: "warning", sentence: "server.example 서버에서 앱의 Python 코드를 실행합니다", rows: [], notes: ["1시간 1분 1초마다 스스로 실행됩니다", "바깥에서 주소로 불러 실행할 수 있습니다", "다른 앱의 서버 코드를 부릅니다: first, second", "실행한 코드는 그 컴퓨터의 파일과 인터넷에 닿습니다"], details: { label: "코드 보기", code: "print('ok')" } });
    for (const permission of permissions) expect(groups.flatMap((g) => g.rows).some((row) => row.reason?.includes(permission.label))).toBe(true);
    expect(describeInstallScope({ ...base, client: { ...client, capabilities: ["share", "instructions", "receive_message"] }, storage: { entries: [] }, agent: definition.agent }, "unknown")).toEqual([]);
    expect(describeInstallScope({ ...base, worker: definition.worker }, "embedded")[0].sentence).toBe("이 PC에서 앱의 Python 코드를 실행합니다");
    expect(describeInstallScope({ ...base, worker: definition.worker }, "unknown")[0].sentence).toBe("연결한 서버에서 앱의 Python 코드를 실행합니다");
  });

  it("모르는 권한과 기능도 숨기지 않는다", () => {
    const definition = { ...base, permissions: [{ module: "future", id: "new", label: "새 이유" }], client: { ...client, capabilities: ["future-capability"] } } as unknown as AppDefinition;
    expect(describeInstallScope(definition, "unknown")).toEqual([
      { tone: "normal", sentence: "이 쉘이 모르는 권한을 씁니다", rows: [{ target: "future", reason: "새 이유" }], notes: [] },
      { tone: "normal", sentence: "이 쉘이 모르는 기능을 씁니다", rows: [{ target: "future-capability" }], notes: [] },
    ]);
  });
});
