import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & {
  /** Цвет ступеней; по умолчанию — CSS-переменная --logo-accent */
  accent?: string;
  /** Цвет буквы C; по умолчанию — currentColor */
  ink?: string;
  title?: string;
};

export function LogoMark({
  accent = 'var(--logo-accent, #0F9488)',
  ink = 'currentColor',
  title = 'Cadence Lab',
  ...props
}: Props) {
  return (
    <svg viewBox="0 0 138 80" role="img" aria-label={title} {...props}>
      <g fill={accent}>
        <rect x="0" y="54" width="18" height="26" />
        <rect x="24" y="27" width="18" height="53" />
        <rect x="48" y="0" width="18" height="80" />
      </g>
      <path fill={ink} d="M78 0H138V18H96V62H138V80H78Z" />
    </svg>
  );
}
