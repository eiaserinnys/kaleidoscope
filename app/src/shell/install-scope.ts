import { knownFolderNames, type AppDefinition } from "@kaleidoscope/ui";

type PermissionDecl = AppDefinition["permissions"][number];
type ClientDecl = NonNullable<AppDefinition["client"]>;
type ClientCapability = NonNullable<ClientDecl["capabilities"]>[number];
type WorkerDecl = NonNullable<AppDefinition["worker"]>;

export type ConsentRow = { target?: string; reason?: string };
export type ConsentGroup = { tone: "warning" | "normal"; sentence: string; rows: ConsentRow[]; notes: string[]; details?: { label: "코드 보기"; code: string } | { label: "자세히"; hosts: Array<{ host: string; paths: string[] }> } };

// 코어 crates/core/src/store/install.rs scope()와 같은 다섯 키.
const scopeKeys: Record<Extract<keyof AppDefinition, "permissions" | "storage" | "client" | "worker" | "agent">, string> = {
  permissions: "permissionKinds가 하나씩 문장으로 만든다",
  storage: "계정과 앱마다 따로인 앱 자기 저장소라 다른 앱과 이 PC 파일에 닿지 않는다",
  client: "격리 프레임에서 돌고 바깥 네트워크가 막혀 있다. clientFields와 capabilityKinds가 가른다",
  worker: "worker 문장으로 보인다. workerFields가 가른다",
  agent: "대화는 agent.permission이 가리키는 연결 권한으로만 나가고 그 연결은 connection 문장에 보인다",
};
void scopeKeys;

const permissionKinds: { [M in PermissionDecl["module"]]: "shown" } = {
  files: "shown", connection: "shown", http: "shown", process: "shown", profiler: "shown", store: "shown",
};
const capabilityKinds: Record<ClientCapability, "shown" | { hidden: string }> = {
  context_capture: "shown", keep_awake: "shown",
  share: { hidden: "보낼 때마다 사용자가 OS 공유 창에서 받을 곳을 고른다" },
  instructions: { hidden: "쉘에 든 앱 작성 지침 글을 읽기만 한다" },
  receive_message: { hidden: "다른 창이 보낸 글을 받기만 하고 창 밖으로 내보내지 않는다" },
};
// 클라이언트는 격리 프레임에서 돌고 바깥 네트워크가 막혀 있다.
const clientFields: Record<keyof ClientDecl, string> = {
  runtime: "창 안의 값과 동작", entry: "창 안의 값과 동작", inputs: "창 안의 값과 동작", outputs: "창 안의 값과 동작",
  channels: "창 안의 값과 동작", actions: "창 안의 값과 동작", commands: "창 안의 값과 동작", state_keys: "창 안의 값과 동작",
  storage_entries: "앱 자기 저장소",
  http_permissions: "permissions에 선언한 권한을 가리킬 뿐이고 그 권한은 permissions 문장에 보인다",
  process_permissions: "permissions에 선언한 권한을 가리킬 뿐이고 그 권한은 permissions 문장에 보인다",
  realtime_permissions: "permissions에 선언한 권한을 가리킬 뿐이고 그 권한은 permissions 문장에 보인다",
  device_storage: "이 기기에 앱 전용으로 남기는 파일이라 다른 앱과 사용자 파일에 닿지 않는다",
  capabilities: "capabilityKinds가 하나씩 가른다",
};
const workerFields: Record<keyof WorkerDecl, string> = {
  code: "worker 문장과 notes, 코드 보기에 보인다", schedule: "worker 문장과 notes, 코드 보기에 보인다",
  webhook: "worker 문장과 notes, 코드 보기에 보인다", calls: "worker 문장과 notes, 코드 보기에 보인다",
  runtime: "실행 방식과 창이 부르는 동작 이름", timeout_secs: "실행 방식과 창이 부르는 동작 이름", actions: "실행 방식과 창이 부르는 동작 이름",
  watch_entries: "앱 자기 저장소의 변경 감시", secrets: "서버에 따로 넣는 값을 읽기만 하고 값은 앱 정의에 없다",
};
void clientFields;
void workerFields;

function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours ? `${hours}시간` : "", minutes ? `${minutes}분` : "", remaining || (!hours && !minutes) ? `${remaining}초` : ""].filter(Boolean).join(" ");
}

export function describeInstallScope(definition: AppDefinition, workerPlace: "embedded" | "remote" | "unknown", workerHost?: string): ConsentGroup[] {
  const groups: Array<ConsentGroup | undefined> = [];
  const group = (index: number, sentence: string, tone: ConsentGroup["tone"] = "normal") =>
    groups[index] ??= { tone, sentence, rows: [], notes: [] };
  const httpHosts = new Map<string, { labels: string[]; paths: string[] }>();
  const defaultFolders = new Map<string, ConsentGroup>();

  for (const permission of definition.permissions) {
    if (!Object.hasOwn(permissionKinds, permission.module)) {
      const unknown = permission as unknown as { module: string; label: string };
      group(12, "이 쉘이 모르는 권한을 씁니다").rows.push({ target: unknown.module, reason: unknown.label });
      continue;
    }
    switch (permission.module) {
      case "process": {
        const item = group(0, "이 PC에서 프로그램을 실행합니다", "warning");
        item.rows.push(permission.command ? { target: permission.command, reason: permission.label } : { reason: permission.label });
        item.notes = [
          ...(item.rows.some((row) => !row.target) ? ["실행할 프로그램은 그때마다 묻습니다"] : []),
          "실행한 프로그램은 내 계정 권한으로 파일과 인터넷에 닿습니다",
        ];
        break;
      }
      case "files": {
        if (permission.scope !== "pc" && permission.default_folder) {
          const key = `${permission.default_folder}:${permission.access}`;
          let item = defaultFolders.get(key);
          if (!item) {
            item = { tone: "normal", sentence: `${knownFolderNames[permission.default_folder]} 폴더나 내가 고른 폴더의 파일을 ${permission.access === "read" ? "읽습니다" : "읽고 고칩니다"}`, rows: [], notes: [] };
            defaultFolders.set(key, item);
          }
          item.rows.push({ reason: permission.label });
          break;
        }
        const index = permission.scope === "pc" ? 4 : permission.access === "read" ? 2 : 3;
        const sentence = index === 4 ? "이 PC의 파일을 둘러보고 읽습니다" : index === 2 ? "내가 고른 폴더의 파일을 읽습니다" : "내가 고른 폴더의 파일을 읽고 고칩니다";
        group(index, sentence).rows.push({ reason: permission.label });
        break;
      }
      case "connection": {
        const read = permission.access === "read";
        group(read ? 5 : 6, read ? "연결한 서비스의 자료를 읽습니다" : "연결한 서비스의 자료를 읽고 고칩니다").rows.push({ target: permission.connection, reason: permission.label });
        break;
      }
      case "http": {
        const host = new URL(permission.base_url).host;
        const item = httpHosts.get(host) ?? { labels: [], paths: [] };
        if (!item.labels.includes(permission.label)) item.labels.push(permission.label);
        for (const path of permission.paths) if (!item.paths.includes(path)) item.paths.push(path);
        httpHosts.set(host, item);
        break;
      }
      case "store": group(9, "스토어에서 앱을 설치하고 지웁니다").rows.push({ reason: permission.label }); break;
      case "profiler": group(10, "이 기기에서 쉘의 성능을 재고 기록을 봅니다").rows.push({ reason: permission.label }); break;
      default: { const exhaustive: never = permission; void exhaustive; }
    }
  }
  if (httpHosts.size) {
    const item = group(7, "인터넷에서 자료를 받아옵니다");
    item.rows = Array.from(httpHosts, ([target, value]) => ({ target, reason: value.labels.join(", ") }));
    item.details = { label: "자세히", hosts: Array.from(httpHosts, ([host, value]) => ({ host, paths: value.paths })) };
  }
  const worker = definition.worker;
  if (worker) {
    const sentence = workerPlace === "embedded" ? "이 PC에서 앱의 Python 코드를 실행합니다" : workerPlace === "remote" ? `${workerHost} 서버에서 앱의 Python 코드를 실행합니다` : "연결한 서버에서 앱의 Python 코드를 실행합니다";
    const item = group(1, sentence, "warning");
    if (worker.schedule) item.notes.push(`${duration(worker.schedule.interval_secs)}마다 스스로 실행됩니다`);
    if (worker.webhook) item.notes.push("바깥에서 주소로 불러 실행할 수 있습니다");
    if (worker.calls?.length) item.notes.push(`다른 앱의 서버 코드를 부릅니다: ${worker.calls.join(", ")}`);
    item.notes.push("실행한 코드는 그 컴퓨터의 파일과 인터넷에 닿습니다");
    item.details = { label: "코드 보기", code: worker.code };
  }
  for (const capability of definition.client?.capabilities ?? []) {
    if (!Object.hasOwn(capabilityKinds, capability)) {
      group(13, "이 쉘이 모르는 기능을 씁니다").rows.push({ target: capability });
    } else if (capability === "context_capture") {
      group(8, "같이 보기를 켠 창의 화면과 글을 읽습니다");
    } else if (capability === "keep_awake") {
      group(11, "화면이 꺼지지 않게 합니다");
    }
  }
  return [...groups.slice(0, 4).filter((item): item is ConsentGroup => item !== undefined), ...defaultFolders.values(), ...groups.slice(4).filter((item): item is ConsentGroup => item !== undefined)];
}
