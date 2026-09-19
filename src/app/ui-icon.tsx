import type { CSSProperties } from "react";

const paths = {
  close: "m6 6 12 12 M6 18 18 6",
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  search: "m21 21-5-5 M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  jobs: "M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1 M8 7V4h8v3 M3 12a22 22 0 0 0 18 0 M10 12h4v3h-4z",
  applications: "M4 4h16v16H4z M9 4v16 M15 4v16",
  review: "M9 3H5v18h14V3h-4 M9 2h6v4H9z m-1 11 3 3 5-6",
  companies: "M4 21V3h11v18 M15 9h5v12 M8 7h3 M8 11h3 M8 15h3 M8 21v-3h3v3 M2 21h20",
  answers: "M21 11a8 8 0 0 1-8 8H7l-5 3 1.5-6A8 8 0 0 1 3 5a10 10 0 0 1 18 6 M7 9h10 M7 13h6",
  profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  analytics: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4",
  settings: "M4 6h5 M13 6h7 M4 12h10 M18 12h2 M4 18h2 M10 18h10 M9 3v6h4V3z M14 9v6h4V9z M6 15v6h4v-6z",
  ai: "M8 8h8v8H8z M5 5h14v14H5z M9 2v3 M15 2v3 M9 19v3 M15 19v3 M2 9h3 M2 15h3 M19 9h3 M19 15h3",
  mailbox: "M3 5h18v14H3z m0 1 9 7 9-7",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
  moon: "M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 8l-3 5-5 3 3-5z",
  contacts: "M13 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0 M2 20v-1.5a7.5 7.5 0 0 1 15 0V20 M17 5.5a3 3 0 0 1 0 6 M19 20v-1.5a5 5 0 0 0-2-4",
  check: "m5 12 4 4L19 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className, style }: { name: IconName; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
