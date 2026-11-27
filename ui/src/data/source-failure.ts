import type { AppDefinition, SourceStatus } from "../contract/contract";

export function isOptionalSource(definition: AppDefinition, name: string): boolean {
  const source = definition.sources?.[name];
  return source?.kind === "request" && source.optional === true;
}

/** 창 알림이 다루는 원천 실패. 받은 값을 지닌 채 실패했거나, 값 없이 실패해도 알리는 선택 원천이다. */
export function isNoticeFailure(definition: AppDefinition, name: string, status: SourceStatus | undefined): boolean {
  return status?.state === "failed" && (status.has_value || isOptionalSource(definition, name));
}

/** 다시 받는 중에도 실패 알림을 유지할 상태. 화면에 보이는 값이 있거나, 값이 없어도 선택 원천이면 유지한다. */
export function isRetainedLoading(definition: AppDefinition, name: string, status: SourceStatus): boolean {
  return status.state === "loading" && (status.has_value || isOptionalSource(definition, name));
}
