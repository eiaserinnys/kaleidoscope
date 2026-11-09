import type { ThemePreference } from "../contract/contract";

/** 지금 화면에 보이는 테마. 선택(`ThemePreference`)과 운영체제 설정에서 정한다. */
export type Theme = "light" | "dark";

/// 테마의 정본은 문서 루트의 `data-theme` 하나다. 토큰 CSS, HTML 보기, 쉘 창 제목 줄이 모두 이 값을 따르고,
/// 운영체제 설정은 선택이 `system`일 때만 여기서 읽는다.
const listeners = new Set<(theme: Theme) => void>();
const systemDark = typeof window === "undefined" ? undefined : window.matchMedia?.("(prefers-color-scheme: dark)");
let preference: ThemePreference = "system";

function resolve(): Theme {
  if (preference !== "system") return preference;
  return systemDark?.matches ? "dark" : "light";
}

function apply(): void {
  if (typeof document === "undefined") return;
  const theme = resolve();
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  listeners.forEach((listener) => listener(theme));
}

/** 이 기기에서 고른 테마를 적용한다. 같은 값을 다시 주면 아무 일도 하지 않는다. */
export function setThemePreference(next: ThemePreference): void {
  preference = next;
  apply();
}

export function currentTheme(): Theme {
  return resolve();
}

/** 보이는 테마가 바뀔 때마다 부른다. 돌려준 함수로 그만 듣는다. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

systemDark?.addEventListener("change", apply);
// 모듈을 읽는 순간 운영체제 테마로 시작한다. 기기 선택은 상태를 받은 뒤 `setThemePreference`로 덮는다.
apply();
