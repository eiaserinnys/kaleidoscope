import type { ReactNode } from "react";

export function SettingsRow({ label, meta, status, control }: { label: ReactNode; meta?: ReactNode; status?: ReactNode; control?: ReactNode }) {
  return <div className="ks-settings-row">
    <div className="ks-settings-row-text"><div className="ks-settings-row-label">{label}{status}</div>{meta}</div>
    <div className="ks-settings-row-control">{control}</div>
  </div>;
}
