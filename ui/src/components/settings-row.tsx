import type { ReactNode } from "react";

export function SettingsRow({ label, meta, status, control }: { label: ReactNode; meta?: ReactNode; status?: ReactNode; control?: ReactNode }) {
  const hasControl = control !== null && control !== undefined && control !== false;
  return <div className={`ks-settings-row${hasControl ? "" : " is-without-control"}`}>
    <div className="ks-settings-row-text"><div className="ks-settings-row-label">{label}{status}</div>{meta}</div>
    {hasControl ? <div className="ks-settings-row-control">{control}</div> : null}
  </div>;
}
