import { useCallback, useLayoutEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { Dialog, isWindowTop, useShellSelector, type AppDefinition, type ShellStore } from "@kaleidoscope/ui";

type Permission = AppDefinition["permissions"][number];

export function InstallationConsent({ store, windowId, host }: { store: ShellStore; windowId: string; host: HTMLElement | null }) {
  const subscribe = useCallback((listener: () => void) => store.subscribeInstallConsent(windowId, listener), [store, windowId]);
  const getRequest = useCallback(() => store.getInstallConsent(windowId), [store, windowId]);
  const request = useSyncExternalStore(subscribe, getRequest, getRequest);
  const active = useShellSelector(store, (snapshot) => isWindowTop(snapshot, windowId));
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
  return <Dialog key={request.request_id} host={host} windowId={windowId} userConsent windowModal active={active}
    overlayClassName="ks-window-consent-overlay ks-install-consent" inertSelector=":scope > .ks-window-content"
    title="이 앱을 설치할까요?" ok="허용하고 설치" onCancel={cancel} onConfirm={confirm}
    body={<>
      <div><strong className="ks-consent-value">{request.app_name}</strong> · {request.release}판<br /><span className="ks-consent-value">{request.store_url}</span></div>
      {definition.permissions.some((permission) => permission.module === "process") ? <strong className="ks-install-warning">이 PC에서 프로그램을 실행할 수 있습니다.</strong> : null}
      {definition.worker ? <strong className="ks-install-warning">연결한 서버에서 Python 코드를 실행합니다. 내장 서버라면 이 PC에서 실행합니다.</strong> : null}
      {empty ? <span>선언된 권한이 없습니다.</span> : null}
      {definition.permissions.map((permission) => <PermissionEntry key={permission.id} permission={permission} />)}
      {definition.storage?.entries.map((entry) => <section key={entry.id}>
        <strong>저장소 · <span className="ks-consent-value">{entry.label}</span></strong>
        <Fields values={{ id: entry.id, key: entry.key, kind: entry.kind === "md" ? "Markdown 문서" : "JSON", collection: entry.collection ? "모음" : "단일 항목", presentation: entry.presentation === "settings" ? "설정" : "앱 내부", description: entry.description, choices: entry.choices, agent_context: entry.agent_context }} />
        <div>범위: 계정과 앱별{entry.key.includes("{workspace_id}") ? ", 작업별" : ""}</div>
        <details><summary>기본값과 스키마</summary><pre className="ks-process-command">{JSON.stringify({ 기본값: entry.default, 스키마: entry.schema }, null, 2)}</pre></details>
      </section>)}
      {definition.client ? <section>
        <strong>격리 클라이언트 코드 실행</strong>
        <Fields values={{ ...definition.client,
          capabilities: definition.client.capabilities?.map((item) => capabilityLabels[item]),
          device_storage: definition.client.device_storage && { ...definition.client.device_storage, scope: definition.client.device_storage.scope === "window" ? "창별" : "앱별" },
        }} />
        {definition.client.device_storage ? <div>기기 저장 파일 하나의 한도: 512 MiB</div> : null}
      </section> : null}
      {definition.worker ? <section>
        <strong>서버 실행 코드</strong>
        <Fields values={{ ...definition.worker, code: undefined }} />
        <details><summary>코드 보기</summary><pre className="ks-process-command">{definition.worker.code}</pre></details>
      </section> : null}
      {definition.agent ? <section><strong>대화 제공자</strong><Fields values={definition.agent} /></section> : null}
    </>} />;
}

function PermissionEntry({ permission }: { permission: Permission }) {
  let content: ReactNode;
  switch (permission.module) {
    case "files":
      content = <>{permission.access === "read" ? "읽기" : "읽기와 쓰기"} · {permission.scope === "pc" ? "PC 전체" : "선택한 폴더"}</>;
      break;
    case "connection":
      content = <>연결 <span className="ks-consent-value">{permission.connection}</span> · {permission.access === "read" ? "읽기" : "읽기와 쓰기"} · 로그인은 사용할 때 별도로 합니다.</>;
      break;
    case "http":
      content = <><div>기준 주소: <span className="ks-consent-value">{permission.base_url}</span></div><div>허용 경로: <Values value={permission.paths} /></div></>;
      break;
    case "process":
      content = <>이 PC에서 프로그램 실행</>;
      break;
    case "profiler":
      content = <>이 기기의 성능 기록 조회와 측정</>;
      break;
    case "store":
      content = <>스토어 읽기, 설치와 삭제</>;
      break;
    default: {
      const exhaustive: never = permission;
      return exhaustive;
    }
  }
  return <section><strong><span className="ks-consent-value">{permission.label}</span></strong> · <span className="ks-consent-value">{permission.id}</span><div>{content}</div></section>;
}

const labels: Record<string, string> = {
  id: "식별자", key: "저장 키", kind: "형식", collection: "모음", presentation: "표시", description: "설명", choices: "선택지", agent_context: "에이전트 문맥",
  runtime: "실행 환경", entry: "시작 자산", version: "판", inputs: "입력", outputs: "출력", channels: "채널", actions: "동작", commands: "명령", state_keys: "창 상태", storage_entries: "저장소 접근", http_permissions: "HTTPS 권한", process_permissions: "프로그램 권한", realtime_permissions: "실시간 연결 권한", device_storage: "기기 저장", capabilities: "기능", prefixes: "저장 접두사", scope: "범위",
  timeout_secs: "제한 시간(초)", schedule: "일정", interval_secs: "간격(초)", jitter_secs: "지연 범위(초)", enabled_entry: "활성 설정", webhook: "웹훅", token_secret: "토큰 비밀값 이름", calls: "호출 허용 앱", watch_entries: "변경 감시 저장소", secrets: "비밀값 이름",
  protocol: "대화 방식", permission: "연결 권한", base_path: "경로", namespace: "이름 공간", profile: "프로필", model_order: "모델 순서", selected_model: "선택 모델", title_template: "제목 양식", initial_instruction_template: "처음 지시", instructions_template: "지시", thread_entry: "대화 저장 항목", expr: "식", state: "상태", default: "기본값",
};

function Fields({ values }: { values: object }) {
  return <>{Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => key.endsWith("_template")
    ? <details key={key}><summary>{labels[key] ?? key}</summary><Values value={value} /></details>
    : <div key={key}><span>{labels[key] ?? key}: </span><Values value={value} /></div>)}</>;
}

const capabilityLabels = {
  share: "공유", keep_awake: "화면 켜두기", instructions: "사용 지침", context_capture: "화면 맥락", receive_message: "메시지 받기",
};

function Values({ value }: { value: unknown }): ReactNode {
  if (value === null) return <span className="ks-consent-value">없음</span>;
  if (Array.isArray(value)) return value.length ? <span>{value.map((item, index) => <span key={index}>{index ? ", " : ""}<Values value={item} /></span>)}</span> : <span>없음</span>;
  if (typeof value === "object") return <span>{Object.entries(value).map(([key, item], index) => <span key={key}>
    {index ? ", " : ""}{labels[key] ?? key}: <Values value={item} />
  </span>)}</span>;
  return <span className="ks-consent-value">{typeof value === "boolean" ? (value ? "예" : "아니요") : String(value)}</span>;
}
