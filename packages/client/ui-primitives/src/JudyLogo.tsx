import type { IconProps } from './icons/props.ts'

/**
 * Render the JUDY brand mark (the abstract-node logo) as a square image.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the JUDY logo img (decorative brand art).
 */
export function JudyLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/favicon.png"
      width={size}
      height={size}
      className={className}
      alt=""
    />
  )
}
