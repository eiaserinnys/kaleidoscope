import { memo, type KeyboardEventHandler, type MouseEventHandler, type ReactNode } from "react";

export const CommentCardBody = memo(function CommentCardBody({ id, className = "", active, resolved, pin, target, targetRef, activate, tools, unread, text, last, children, onKeyDown }: {
  id?: string; active: boolean; resolved: boolean; pin: ReactNode; target: string;
  className?: string;
  targetRef?: React.Ref<HTMLButtonElement>; activate: () => void; tools?: ReactNode;
  unread: boolean; text: string; last?: { author: "user" | "agent"; text: string }; children?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}) {
  const targetClick: MouseEventHandler = (event) => { event.stopPropagation(); activate(); };
  return <article className={`ks-html-comment${className ? ` ${className}` : ""}${active ? " is-active" : ""}${resolved ? " is-resolved" : ""}`} id={id} onClick={() => { if (!active) activate(); }} onKeyDown={onKeyDown}>
    {pin}
    <div className="ks-html-comment-head"><button ref={targetRef} type="button" className="ks-html-comment-target" onClick={targetClick}>{target}</button>
      {active ? tools : unread ? <span className="ks-badge is-accent">답변 도착</span> : null}
    </div>
    <p className="ks-html-comment-text">{text}</p>
    {!active && last ? <span className="ks-html-comment-last">{last.author === "agent" ? "에이전트" : "나"}: {last.text}</span> : null}
    {active ? children : null}
  </article>;
});
