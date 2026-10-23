import { JudyLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the JUDY mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the JUDY brand mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <JudyLogo size={size} />
}

/**
 * Render the JUDY name artwork without its independently slotted mark.
 * @returns the JUDY brand mark.
 */
export function OfficialBrandName() {
  return <JudyLogo size={24} />
}
