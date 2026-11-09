import { useId, useState } from "react";
import { ErrorNotice, SettingsRow, toCoreError, useShellSelector, type CoreError, type ShellStore, type ThemePreference } from "@kaleidoscope/ui";
import { Select } from "../../../ui/src/components/select-toggle";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

/** 이 기기의 화면 테마. 서버를 바꿔도 남고 다른 기기로 가지 않는다. 적용은 호스트가 네이티브 창에 한다. */
export function ThemeSettings({ store }: { store: ShellStore }) {
  const id = useId();
  const theme = useShellSelector(store, (snapshot) => snapshot?.theme ?? "system");
  const [error, setError] = useState<CoreError | null>(null);
  const change = async (next: ThemePreference) => {
    setError(null);
    try { await store.call({ op: "theme.set", theme: next }); }
    catch (cause) { setError(toCoreError(cause)); }
  };
  return <section className="ks-settings-group" aria-labelledby={`${id}-theme`}>
    <h3 className="ks-data-section-title" id={`${id}-theme`}>화면</h3>
    <SettingsRow label={<span>테마</span>}
      meta={theme === "system" ? <span className="shell-server-meta" id={`${id}-theme-hint`}>운영체제 설정을 따릅니다</span> : null}
      control={<Select label="테마" segmented items={THEMES} value={theme}
        describedBy={theme === "system" ? `${id}-theme-hint` : undefined}
        onChange={(value) => { if (value === "system" || value === "light" || value === "dark") void change(value); }} />} />
    {error ? <ErrorNotice error={error} /> : null}
  </section>;
}
