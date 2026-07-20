// Discovered Intelligence branding for the nav rail. The mark (currentColor, so it takes
// the theme's brand ink) shows when the rail is collapsed; the full wordmark — a light or
// dark variant to sit on the theme's rail — replaces it when the rail expands. The full
// logos are bundled SVG assets (same-origin, no external request); the mark is inlined so
// it can inherit currentColor.

import logoDark from '../assets/logo-dark.svg';
import logoLight from '../assets/logo-light.svg';

/** The square DI mark, drawn in currentColor so the rail can theme it. */
export function BrandMark() {
  return (
    <svg className="brand-mark-svg" viewBox="0 0 316 325" aria-hidden="true">
      <g transform="translate(0,325) scale(0.1,-0.1)" fill="currentColor" stroke="none">
        <path d="M0 3080 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M410 3082 c0 -87 2 -161 4 -163 2 -2 77 -3 165 -1 l161 3 0 159 0 160 -165 0 -165 0 0 -158z" />
        <path d="M830 3080 c0 -121 3 -160 13 -160 6 0 78 -2 160 -3 l147 -2 0 163 0 162 -160 0 -160 0 0 -160z" />
        <path d="M1250 3085 c0 -85 0 -157 0 -161 0 -3 71 -5 158 -5 l157 0 3 160 2 161 -160 0 -160 0 0 -155z" />
        <path d="M1660 2872 l0 -370 74 -16 c272 -61 403 -232 446 -581 36 -292 11 -684 -55 -847 -73 -181 -191 -272 -387 -300 l-78 -11 0 -370 0 -370 138 6 c149 7 355 41 492 82 234 70 436 219 591 437 67 95 162 290 193 401 54 187 76 384 76 681 0 471 -87 821 -272 1101 -100 151 -281 311 -443 393 -66 33 -214 78 -310 95 -124 22 -159 25 -322 33 l-143 7 0 -371z" />
        <path d="M0 2660 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M410 2660 l0 -160 165 0 165 0 0 160 0 160 -165 0 -165 0 0 -160z" />
        <path d="M830 2660 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M1250 2660 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M412 2248 l3 -162 25 1 c14 0 87 1 163 2 l137 1 0 160 0 160 -165 0 -165 0 2 -162z" />
        <path d="M830 2250 l0 -159 160 -3 160 -3 0 163 0 162 -160 0 -160 0 0 -160z" />
        <path d="M410 1830 l0 -160 165 0 165 0 0 160 0 160 -165 0 -165 0 0 -160z" />
        <path d="M830 1830 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M410 1421 c0 -169 1 -171 50 -165 14 1 82 3 153 3 l127 1 0 160 0 160 -165 0 -165 0 0 -159z" />
        <path d="M830 1418 l0 -163 152 2 c84 2 156 3 161 3 4 0 7 72 7 160 l0 160 -160 0 -160 0 0 -162z" />
        <path d="M410 1000 l0 -160 165 0 165 0 0 160 0 160 -165 0 -165 0 0 -160z" />
        <path d="M830 1000 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M0 585 l0 -165 160 0 160 0 0 165 0 165 -160 0 -160 0 0 -165z" />
        <path d="M410 591 c0 -118 3 -160 13 -163 21 -7 275 -10 296 -3 20 6 21 14 21 166 l0 159 -165 0 -165 0 0 -159z" />
        <path d="M832 588 l3 -163 134 -3 c73 -2 144 -1 157 2 l24 6 0 160 0 160 -160 0 -160 0 2 -162z" />
        <path d="M1248 728 c-2 -13 -2 -86 0 -164 l3 -141 114 -2 c63 -1 135 1 160 4 l45 7 0 159 0 159 -159 0 c-158 0 -160 0 -163 -22z" />
        <path d="M0 170 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M410 170 l0 -160 165 0 165 0 0 160 0 160 -165 0 -165 0 0 -160z" />
        <path d="M830 170 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
        <path d="M1250 170 l0 -160 160 0 160 0 0 160 0 160 -160 0 -160 0 0 -160z" />
      </g>
    </svg>
  );
}

/** The nav-rail brand: the mark alone when collapsed, the full wordmark when expanded. */
export function Brand({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div className="navrail-brand">
      <span className="brand-mark" aria-hidden="true">
        <BrandMark />
      </span>
      <img className="navrail-logo" src={theme === 'dark' ? logoDark : logoLight} alt="Discovered Intelligence" />
    </div>
  );
}
