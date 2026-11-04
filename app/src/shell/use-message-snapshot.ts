import { useShellSelector, type ShellStore } from "@kaleidoscope/ui";

export function useMessageSnapshot(store: ShellStore) {
  return useShellSelector(store, (snapshot) => snapshot, (left, right) => left === right || Boolean(left && right
    && left.link === right.link
    && left.shared.apps === right.shared.apps
    && left.shared.app_versions === right.shared.app_versions
    && left.shared.preferences === right.shared.preferences));
}
