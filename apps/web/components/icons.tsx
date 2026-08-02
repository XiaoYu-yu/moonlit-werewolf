import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size} {...props}>
      {children}
    </svg>
  );
}

export const Icons = {
  wolf: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="m4 20 2-8-2-6 6 3 2-6 3 6 5-2-2 7 2 6-7-3-9 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="m9.5 13 2.5 1 3-2-1 4-2 1-2.5-4Z" fill="currentColor" />
    </Icon>
  ),
  settings: (props: IconProps) => (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 0 0-2.1-1.2L14 3h-4l-.4 2.7c-.8.3-1.5.7-2.1 1.2l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.4-2.7c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </Icon>
  ),
  sound: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="M5 9v6h4l5 4V5L9 9H5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M17 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </Icon>
  ),
  mic: (props: IconProps) => (
    <Icon {...props}>
      <rect height="11" rx="3" stroke="currentColor" strokeWidth="1.7" width="6" x="9" y="2" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v4M8.5 22h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </Icon>
  ),
  bot: (props: IconProps) => (
    <Icon {...props}>
      <rect height="12" rx="3" stroke="currentColor" strokeWidth="1.5" width="16" x="4" y="7" />
      <path
        d="M12 3v4M9 12h.01M15 12h.01M9 16h6M2 11v4M22 11v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </Icon>
  ),
  user: (props: IconProps) => (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 21a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </Icon>
  ),
  copy: (props: IconProps) => (
    <Icon {...props}>
      <rect height="12" rx="2" stroke="currentColor" strokeWidth="1.6" width="12" x="8" y="8" />
      <path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </Icon>
  ),
  chevron: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="m8 10 4 4 4-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </Icon>
  ),
  moon: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </Icon>
  ),
  sun: (props: IconProps) => (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </Icon>
  ),
  shield: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="M12 3 4.5 6v5c0 5 3.2 8.3 7.5 10 4.3-1.7 7.5-5 7.5-10V6L12 3Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </Icon>
  ),
  close: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </Icon>
  ),
  arrow: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="M5 12h14M14 7l5 5-5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </Icon>
  ),
  home: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M8 9h8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </Icon>
  ),
  door: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="M4 21h16M7 21V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M13.5 12h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
      <path
        d="m2.5 12 2.25-2.25M2.5 12l2.25 2.25M2.5 12h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </Icon>
  ),
  binoculars: (props: IconProps) => (
    <Icon {...props}>
      <path
        d="m8.5 8.5 1-3h5l1 3M8.5 8.5H6.8a2 2 0 0 0-1.9 1.35L2.5 17a2.7 2.7 0 0 0 5.1 1.75L9 15h6l1.4 3.75A2.7 2.7 0 0 0 21.5 17l-2.4-7.15a2 2 0 0 0-1.9-1.35h-1.7M8.5 8.5 9 15M15.5 8.5 15 15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <circle cx="5.2" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.8" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  ),
};
