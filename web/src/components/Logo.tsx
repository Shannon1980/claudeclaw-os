// ClaudeClaw mark: three claw rakes. Same geometry as build/icon.svg, trimmed
// to the mark's bounding box so it sits flush in a button or tile.
// `Logo` inherits currentColor; `LogoTile` wraps it in the app-icon square.

const RAKE = 'M -62 -230 C -44 -92, 6 74, 56 248 C 24 68, 40 -88, 62 -228 Q 0 -266, -62 -230 Z';

interface LogoProps {
  size?: number;
  class?: string;
}

export function Logo({ size = 16, class: className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="222 147 740 740"
      fill="currentColor"
      class={className}
      aria-hidden="true"
    >
      <g transform="translate(512 512) rotate(28)">
        <path d={RAKE} transform="translate(-200 -14) rotate(-6)" opacity="0.72" />
        <path d={RAKE} transform="translate(6 24) scale(1.13)" opacity="0.88" />
        <path d={RAKE} transform="translate(210 8) rotate(6) scale(1.05)" />
      </g>
    </svg>
  );
}

interface LogoTileProps {
  size?: number;
  /** Tile background. Defaults to the app icon's dark tile. */
  tint?: string;
  class?: string;
}

export function LogoTile({ size = 24, tint, class: className }: LogoTileProps) {
  return (
    <div
      class={['shrink-0 flex items-center justify-center', className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: tint
          ? `linear-gradient(135deg, ${tint} 0%, #12151f 100%)`
          : 'linear-gradient(135deg, #2c3358 0%, #171b2c 45%, #0a0c13 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)',
        color: '#dfe3ff',
      }}
    >
      <Logo size={Math.round(size * 0.62)} />
    </div>
  );
}
