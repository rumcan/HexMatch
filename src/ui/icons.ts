// UI Space Age (P5): the tool rail's line icons.
// Path data from Tabler Icons (https://tabler.io/icons), MIT License,
// Copyright (c) 2020-2024 Paweł Kuna. Stroke is currentColor.
const ICON_BODY: Record<string, string> = {
  ramp: `<path d="M7 3l0 8.707" /> <path d="M11 7l-4 -4l-4 4" /> <path d="M17 14l4 -4l-4 -4" /> <path d="M7 21a11 11 0 0 1 11 -11h3" />`,
  street: `<path d="M3 21l18 0" /> <path d="M4 21v-11l2.5 -4.5l5.5 -2.5l5.5 2.5l2.5 4.5v11" /> <path d="M10 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M9 21v-5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v5" />`,
  highway: `<path d="M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M5 17h-2v-6l2 -5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6 -6h15m-6 0v-5" />`,
  select: `<path d="M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563" />`,
  dirt: `<path d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /> <path d="M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4" /> <path d="M11 19h5.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h4.5" />`,
  road: `<path d="M4 19l4 -14" /> <path d="M16 5l4 14" /> <path d="M12 8v-2" /> <path d="M12 13v-2" /> <path d="M12 18v-2" />`,
  harvester: `<path d="M3 21v-13l9 -4l9 4v13" /> <path d="M13 13h4v8h-10v-6h6" /> <path d="M13 21v-9a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v3" />`,
  plant: `<path d="M3 21h18" /> <path d="M5 21v-12l5 4v-4l5 4h4" /> <path d="M19 21v-8l-1.436 -9.574a.5 .5 0 0 0 -.495 -.426h-1.145a.5 .5 0 0 0 -.494 .418l-1.43 8.582" /> <path d="M9 17h1" /> <path d="M14 17h1" />`,
  city: `<path d="M8 9l5 5v7h-5v-4m0 4h-5v-7l5 -5m1 1v-6a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v17h-8" /> <path d="M13 7l0 .01" /> <path d="M17 7l0 .01" /> <path d="M17 11l0 .01" /> <path d="M17 15l0 .01" />`,
  rail: `<path d="M4 15l11 -11m5 5l-11 11m-4 -8l7 7m-3.5 -10.5l7 7m-3.5 -10.5l7 7" />`,
  platform: `<path d="M21 13c0 -3.87 -3.37 -7 -10 -7h-8" /> <path d="M3 15h16a2 2 0 0 0 2 -2" /> <path d="M3 6v5h17.5" /> <path d="M3 11v4" /> <path d="M8 11v-5" /> <path d="M13 11v-4.5" /> <path d="M3 19h18" />`,
  dam: `<path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" /> <path d="M4 8h16" /> <path d="M20 12h-16" /> <path d="M4 16h16" /> <path d="M9 4v4" /> <path d="M14 8v4" /> <path d="M8 12v4" /> <path d="M16 12v4" /> <path d="M11 16v4" />`,
  demolish: `<path d="M2 17a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /> <path d="M12 17a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /> <path d="M19 13v4a2 2 0 0 0 2 2h1" /> <path d="M14 19h-10" /> <path d="M4 15h10" /> <path d="M9 11v-5h2a3 3 0 0 1 3 3v6" /> <path d="M5 15v-3a1 1 0 0 1 1 -1h8" /> <path d="M19 17h-3" />`,
};

/** A 24×24 outline icon for a build tool key, or "" if there is none. */
export function toolIconSvg(key: string): string {
  const body = ICON_BODY[key];
  if (!body) return "";
  return `<svg class="tool-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
