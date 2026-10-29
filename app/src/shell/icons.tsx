import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function ChevronDownIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}><path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

export function PlusIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>;
}

export function AppsIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
    <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="6" x="4" y="4" />
    <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="6" x="14" y="4" />
    <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="6" x="4" y="14" />
    <rect height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="6" x="14" y="14" />
  </svg>;
}

export function ImportIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 16v4h14v-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>;
}

export function LinkedCloudIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
    <path d="M7.5 18.25h9.75a4.25 4.25 0 0 0 .1-8.5 5.5 5.5 0 0 0-10.7-.95A4.8 4.8 0 0 0 7.5 18.25Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>;
}

export function UnlinkedCloudIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
    <path d="M7.5 18.25h9.75a4.25 4.25 0 0 0 .1-8.5 5.5 5.5 0 0 0-10.7-.95A4.8 4.8 0 0 0 7.5 18.25Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="m5 5 14 14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
  </svg>;
}

export function CloseIcon(props: IconProps) {
  return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>;
}
