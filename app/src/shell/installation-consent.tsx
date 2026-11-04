import { useCallback, useLayoutEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Dialog, isWindowTop, useShellSelector, type AppDefinition, type ShellStore } from "@kaleidoscope/ui";

type Permission = AppDefinition["permissions"][number];
type StorageEntry = NonNullable<AppDefinition["storage"]>["entries"][number];

export function InstallationConsent({ store, windowId, host }: { store: ShellStore; windowId: string; host: HTMLElement | null }) {
  const subscribe = useCallback((listener: () => void) => store.subscribeInstallConsent(windowId, listener), [store, windowId]);
  const getRequest = useCallback(() => store.getInstallConsent(windowId), [store, windowId]);
  const request = useSyncExternalStore(subscribe, getRequest, getRequest);
  const active = useShellSelector(store, (snapshot) => isWindowTop(snapshot, windowId));
  const workerLocation = useShellSelector(store, (snapshot) => {
    if (!request?.definition.worker) return "";
    const link = snapshot?.link;
    if (link?.state !== "connected" && link?.state !== "offline") return "연결한 서버에서 Python 코드를 실행합니다.";
    return link.mode === "embedded"
      ? "이 PC의 내장 서버에서 Python 코드를 실행합니다."
      : `${new URL(link.server_url).host} 서버에서 Python 코드를 실행합니다.`;
  });
  const answer = useCallback((allow: boolean) => {
    if (!request) return;
    void store.call({ op: "app.respond_install_permission", window_id: windowId, request_id: request.request_id, digest: request.digest, allow });
  }, [request, store, windowId]);
  const cancel = useCallback(() => answer(false), [answer]);
  const confirm = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isTrusted) answer(true);
  }, [answer]);
  useLayoutEffect(() => {
    if (request && active) host?.querySelector<HTMLButtonElement>(".ks-install-consent .ks-dialog-actions > button")?.focus({ preventScroll: true });
  }, [request, active, host]);
  if (!request || !host) return null;
  const definition = request.definition;
  const empty = !definition.permissions.length && !definition.storage?.entries.length && !definition.client && !definition.worker && !definition.agent;
  const client = definition.client;
  const worker = definition.worker;
  return <Dialog key={request.request_id} host={host} windowId={windowId} userConsent windowModal active={active}
    overlayClassName="ks-window-consent-overlay ks-install-consent" inertSelector=":scope > .ks-window-content"
    title="이 앱을 설치할까요?" ok="허용하고 설치" onCancel={cancel} onConfirm={confirm}
    body={<>
      <div><strong className="ks-consent-value">{request.app_name}</strong> · <span className="ks-consent-value">{request.release}판</span><br /><span className="ks-consent-value">{request.store_url}</span></div>
      {definition.permissions.some((permission) => permission.module === "process") ? <strong className="ks-install-warning">이 PC에서 프로그램을 실행할 수 있습니다.</strong> : null}
      {worker ? <strong className="ks-install-warning">{workerLocation}</strong> : null}
      {empty ? <span>선언된 권한이 없습니다.</span> : null}
      {definition.permissions.map((permission) => <PermissionEntry key={permission.id} permission={permission} />)}
      {definition.storage?.entries.map((entry) => <StorageEntryView key={entry.id} entry={entry} />)}
      {client ? <section>
        <strong>격리 클라이언트 코드 실행</strong>
        <Field name="시작 자산" meta><span className="ks-consent-value">{client.entry.id} {client.entry.version}판</span></Field>
        <Fields values={{ ...client, entry: undefined, device_storage: undefined, capabilities: client.capabilities?.map((item) => capabilityLabels[item]) }} />
        {client.device_storage ? <Field name="기기 저장"><span className="ks-consent-value">
          {client.device_storage.prefixes.map((prefix) => `${prefix} 아래`).join(", ")}{client.device_storage.prefixes.length ? ", " : ""}{client.device_storage.scope === "window" ? "창별" : "앱별"}, 파일당 512 MiB
        </span></Field> : null}
      </section> : null}
      {worker ? <section>
        <strong>서버 실행 코드</strong>
        <Fields values={{ ...worker, code: undefined, schedule: undefined, webhook: undefined, secrets: undefined }} />
        {worker.schedule ? <Field name="일정"><span className="ks-consent-value">
          {duration(worker.schedule.interval_secs)}마다, {worker.schedule.enabled_entry}로 켜고 끔{worker.schedule.jitter_secs !== undefined ? `, 지연 최대 ${duration(worker.schedule.jitter_secs)}` : ""}
        </span></Field> : null}
        {worker.webhook ? <Field name="웹훅"><span className="ks-consent-value">
          {worker.webhook.enabled_entry ? `${worker.webhook.enabled_entry}로 켜고 끔` : "켜짐"}, 토큰 비밀값 {worker.webhook.token_secret}
        </span></Field> : null}
        {worker.secrets?.map((secret) => <Field key={secret.id} name="비밀값"><span className="ks-consent-value">
          {secret.id}{secret.description ? ` (${secret.description})` : ""}
        </span></Field>)}
        <Details label="코드 보기"><span className="ks-consent-value">{worker.code}</span></Details>
      </section> : null}
      {definition.agent ? <section><strong>대화 제공자</strong><Fields values={definition.agent} /></section> : null}
    </>} />;
}

function StorageEntryView({ entry }: { entry: StorageEntry }) {
  const scope = `계정과 앱별${entry.key.includes("{workspace_id}") ? ", 작업별" : ""}`;
  return <section>
    <strong><span className="ks-consent-label">저장소 · </span><span className="ks-consent-value">{entry.label}</span></strong>
    <div className="ks-consent-value">{entry.kind === "md" ? "Markdown 문서" : "JSON"} {entry.collection ? "모음" : "단일 항목"}, {entry.presentation === "settings" ? "설정" : "앱 내부"}, {scope}</div>
    <Fields values={{ id: entry.id, key: entry.key, description: entry.description, choices: entry.choices, agent_context: entry.agent_context }} />
    <Details label="기본값과 스키마">{JSON.stringify({ 기본값: entry.default, 스키마: entry.schema }, null, 2)}</Details>
  </section>;
}

function PermissionEntry({ permission }: { permission: Permission }) {
  let content: ReactNode = null;
  switch (permission.module) {
    case "files":
      content = <span className="ks-consent-value">{permission.access === "read" ? "읽기" : "읽기와 쓰기"} · {permission.scope === "pc" ? "PC 전체" : "선택한 폴더"}</span>;
      break;
    case "connection":
      content = <><Field name="연결"><span className="ks-consent-value">{permission.connection} · {permission.access === "read" ? "읽기" : "읽기와 쓰기"}</span></Field><div className="ks-install-meta">로그인은 사용할 때 별도로 합니다.</div></>;
      break;
    case "http":
      content = <><Field name="기준 주소"><Values value={permission.base_url} /></Field><Field name="허용 경로"><Values value={permission.paths} /></Field></>;
      break;
    case "process": break;
    case "profiler": content = <span className="ks-consent-value">이 기기의 성능 기록 조회와 측정</span>; break;
    case "store": content = <span className="ks-consent-value">스토어 읽기, 설치와 삭제</span>; break;
    default: {
      const exhaustive: never = permission;
      return exhaustive;
    }
  }
  return <section><strong><span className="ks-consent-value">{permission.label}</span></strong>{content ? <div>{content}</div> : null}</section>;
}

const labels: Record<string, string> = {
  id: "식별자", key: "저장 키", description: "설명", choices: "선택지", agent_context: "에이전트 문맥",
  runtime: "실행 환경", inputs: "입력", outputs: "출력", channels: "채널", actions: "동작", commands: "명령", state_keys: "창 상태", storage_entries: "저장소 접근", http_permissions: "HTTPS 권한", process_permissions: "프로그램 권한", realtime_permissions: "실시간 연결 권한", capabilities: "기능",
  timeout_secs: "제한 시간(초)", calls: "호출 허용 앱", watch_entries: "변경 감시 저장소",
  protocol: "대화 방식", permission: "연결 권한", base_path: "경로", namespace: "이름 공간", profile: "프로필", collection: "모음", model_order: "모델 순서", selected_model: "선택 모델", title_template: "제목 양식", initial_instruction_template: "처음 지시", instructions_template: "지시", thread_entry: "대화 저장 항목", expr: "식", state: "상태", default: "기본값",
};
const decisionFields = new Set(["storage_entries", "http_permissions", "process_permissions", "realtime_permissions", "capabilities", "calls", "watch_entries", "permission", "profile", "description"]);
const capabilityLabels = {
  share: "공유", keep_awake: "화면 켜두기", instructions: "사용 지침", context_capture: "화면 맥락", receive_message: "메시지 받기",
};

function Field({ name, meta = false, children }: { name: string; meta?: boolean; children: ReactNode }) {
  return <div className={meta ? "ks-install-meta" : undefined}><span className="ks-consent-label">{name}: </span>{children}</div>;
}

function Details({ label, children }: { label: string; children: ReactNode }) {
  return <details className="ks-install-details"><summary className="ks-install-meta">{label}</summary><pre className="ks-process-command">{children}</pre></details>;
}

function Fields({ values }: { values: object }) {
  return <>{Object.entries(values).filter(([, value]) => hasValue(value)).map(([key, value]) => key.endsWith("_template")
    ? <Details key={key} label={labels[key] ?? key}><Values value={value} /></Details>
    : <Field key={key} name={labels[key] ?? key} meta={!decisionFields.has(key)}><Values value={value} /></Field>)}</>;
}

function hasValue(value: unknown): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasValue);
  if (value !== null && typeof value === "object") return Object.values(value).some(hasValue);
  return true;
}

function Values({ value }: { value: unknown }): ReactNode {
  if (value === null) return <span className="ks-consent-value">없음</span>;
  if (Array.isArray(value)) return <>{value.filter(hasValue).map((item, index) => <span key={index}>{index ? ", " : ""}<Values value={item} /></span>)}</>;
  if (typeof value === "object") return <>{Object.entries(value).filter(([, item]) => hasValue(item)).map(([key, item], index) => <span key={key}>
    {index ? ", " : ""}<span className="ks-consent-label">{labels[key] ?? key}: </span><Values value={item} />
  </span>)}</>;
  return <span className="ks-consent-value">{typeof value === "boolean" ? (value ? "예" : "아니요") : value === "" ? "(빈 문자열)" : String(value)}</span>;
}

function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours ? `${hours}시간` : "", minutes ? `${minutes}분` : "", remaining || (!hours && !minutes) ? `${remaining}초` : ""].filter(Boolean).join(" ");
}
