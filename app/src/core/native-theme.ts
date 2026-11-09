import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setThemePreference, useShellSelector, type ShellStore } from "@kaleidoscope/ui";

/**
 * 이 기기에서 고른 테마(`device.theme`)를 화면과 네이티브 창 제목 줄에 함께 적용한다.
 * `system`이면 둘 다 운영체제 설정을 따른다.
 */
export function useDeviceTheme(store: ShellStore): void {
  const theme = useShellSelector(store, (snapshot) => snapshot?.device.theme ?? "system");
  useEffect(() => {
    setThemePreference(theme);
    // 제목 줄 색은 보이는 모양일 뿐이라 실패해도 화면 테마는 그대로 둔다.
    if (isTauri()) void getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => {});
  }, [theme]);
}
