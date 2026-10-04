/** Линейные иконки в одном стиле (как на макете). */
const P: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14",
  plus: "M12 5v14M5 12h14",
  moments: "M4 4h16v16H4zM8 12l3 3 5-6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.3-4.3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.5a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 5l7 7-7 7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4m8-4v4",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  photo: "M4 7h3l2-2h6l2 2h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  video: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  audio: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  note: "M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2",
  sync: "M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5",
  locate: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm0-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3m0 14v3M2 12h3m14 0h3",
  share: "M12 3v12M7 8l5-5 5 5M5 13v7h14v-7",
  close: "M6 6l12 12M18 6 6 18",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  play: "M8 5v14l11-7z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  timeline: "M6 3v18M6 7h12M6 12h8M6 17h10",
  cloud: "M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6m4-6v6",
};

export function Icon({ name, size = 22, stroke = 1.9, className, fill }: { name: keyof typeof P | string; size?: number; stroke?: number; className?: string; fill?: boolean }) {
  return (
    <svg className={`ic ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.more} />
    </svg>
  );
}
