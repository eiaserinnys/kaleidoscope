import { afterEach, expect, it, vi } from "vitest";
import { currentTheme, onThemeChange, setThemePreference } from "../styles/theme";

afterEach(() => setThemePreference("system"));

it("고른 테마를 문서 루트의 data-theme에 두고 바뀔 때만 알린다", () => {
  const listener = vi.fn();
  const stop = onThemeChange(listener);
  setThemePreference("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(currentTheme()).toBe("dark");
  setThemePreference("dark");
  expect(listener).toHaveBeenCalledTimes(1);
  setThemePreference("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(listener).toHaveBeenLastCalledWith("light");
  stop();
});

it("시스템은 운영체제 설정에서 테마를 정한다", () => {
  setThemePreference("system");
  const system = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  expect(document.documentElement.dataset.theme).toBe(system);
});
