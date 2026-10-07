import type { ComponentPropsWithoutRef } from "react";

/** Decorative line drawings only: no records, counters or interaction state. */
export const sectionHeaderMotifs = {
  tasks: "M30 34h108v134H30z M49 64l7 7 13-15 M81 64h38 M49 100l7 7 13-15 M81 100h38 M49 136l7 7 13-15 M81 136h38 M180 63h64v48h-64z M180 138h64v48h-64z M138 102h22v-15h20 M160 102v60h20",
  employees: "M56 62a22 22 0 1 0 44 0 22 22 0 1 0-44 0 M35 154v-18a43 43 0 0 1 86 0v18z M169 87a16 16 0 1 0 32 0 16 16 0 1 0-32 0 M154 157v-13a31 31 0 0 1 62 0v13z M141 83h13 M132 135h13 M93 183h108",
  absences: "M37 91a52 52 0 1 0 104 0 52 52 0 1 0-104 0 M89 57v34l23 16 M172 86c-2-34 17-58 53-69 0 42-10 65-53 69z M172 86l26-32 M171 86v87 M170 126c-32 0-51-13-59-40 35 0 51 10 59 40z",
  notifications: "M44 135h103l-15-22V77a37 37 0 0 0-74 0v36z M78 153a18 18 0 0 0 35 0 M90 32v-9 M156 53l11-11 M164 80h17 M29 53l-11-11 M19 80H6 M190 117h75v55h-75z M190 117l37 29 38-29 M210 188h35",
  hr: "M39 28h116v150H39z M39 48h116 M60 85a15 15 0 1 0 30 0 15 15 0 1 0-30 0 M52 125a23 23 0 0 1 46 0 M114 78h20 M114 96h20 M59 151h75 M186 53h48v134h-48z M186 152h23 M186 123h14 M186 93h23 M186 67h14",
  calendar: "M34 47h148v130H34z M34 80h148 M64 27v39 M151 27v39 M69 102h8 M106 102h8 M143 102h8 M69 131h8 M106 131h8 M143 131h8 M69 159h8 M106 159h8 M211 123a32 32 0 1 0 64 0 32 32 0 1 0-64 0 M243 103v20l13 9",
  trips: "M57 45c-28 0-40 30-22 52l22 28 22-28c18-22 6-52-22-52z M47 75a10 10 0 1 0 20 0 10 10 0 1 0-20 0 M57 143v21c0 27 65 27 65-1v-25c0-27 65-27 65 0v15 M193 46l21 17 47-10-41 30 10 25-17-18-25 7 11-24z",
  team: "M97 37a18 18 0 1 0 36 0 18 18 0 1 0-36 0 M84 100a31 31 0 0 1 62 0 M29 135a14 14 0 1 0 28 0 14 14 0 1 0-28 0 M17 186a26 26 0 0 1 52 0 M178 135a14 14 0 1 0 28 0 14 14 0 1 0-28 0 M166 186a26 26 0 0 1 52 0 M88 111l-24 16 M145 111l25 16 M85 164h54",
  telegram: "M26 54h108v74H81l-24 21v-21H26z M53 81h53 M53 102h36 M186 25h74v54h-74z M197 41l52-4-17 29-10-13-17 8 17-8 27-16 M154 156h89v41h-89z M134 91h27V52h25 M134 107h13v69h7",
  feed: "M29 37h151v144H29z M49 60h78 M49 80h108 M49 103h45v48H49z M111 107h47 M111 128h47 M111 149h31 M201 83h60v67h-28l-18 15v-15h-14z M217 102h28 M217 125h20",
  messages: "M32 35h154v102h-77l-34 27v-27H32z M59 67h95 M59 93h66 M203 98h68v82h-20l-19 17v-17h-29z M220 122h32 M220 146h21",
  payments: "M32 34h104v141l-13-9-13 9-13-9-13 9-13-9-13 9-13-9-13 9z M53 63h61 M53 88h40 M53 114h61 M53 141h40 M177 65h91v78h-91z M177 85h91 M194 121h23 M172 172h71 M217 159l26 13-26 13",
  zoom: "M32 49h132v113H32z M164 86l49-27v94l-49-27z M70 77a18 18 0 1 0 36 0 18 18 0 1 0-36 0 M57 142a31 31 0 0 1 62 0 M237 66a54 54 0 0 1 0 74 M253 45a83 83 0 0 1 0 116",
  members: "M96 82a34 34 0 1 0 68 0 34 34 0 1 0-68 0 M113 85l13 13 24-28 M26 33h39v39H26z M211 125h39v39h-39z M35 150a18 18 0 1 0 36 0 18 18 0 1 0-36 0 M203 35a18 18 0 1 0 36 0 18 18 0 1 0-36 0 M68 52l30 15 M81 138l29-29 M162 58l36-15 M166 100l36 34",
} as const;

type Props = ComponentPropsWithoutRef<"header"> & {
  readonly motif: keyof typeof sectionHeaderMotifs;
};

export function WorkspaceSectionHeader({ motif, className = "", children, ...props }: Props) {
  return <header {...props} className={`ws-section-header ${className}`} data-header-motif={motif}>
    <svg className="ws-section-header-art" viewBox="0 0 520 220" fill="none" aria-hidden="true" focusable="false">
      <g className="ws-section-header-orbits" stroke="currentColor">
        <ellipse cx="340" cy="170" rx="168" ry="120" />
        <ellipse cx="340" cy="170" rx="205" ry="154" />
        <path d="M236 12h220 M285 205h182" strokeDasharray="3 9" />
      </g>
      <path className="ws-section-header-drawing" d={sectionHeaderMotifs[motif]} transform="translate(196 0) rotate(-8 130 110)" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {children}
  </header>;
}
