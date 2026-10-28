/** Same-origin URLs that stream one workspace file as an attachment. */

/**
 * Build the browser download URL for one file in the viewed workspace.
 * @param path - workspace-relative path or an absolute Host path.
 * @returns URL served by the files service with `content-disposition: attachment`.
 */
export function fileDownloadHref(path: string): string {
  if (path.startsWith('/')) return `/files/download?path=${encodeURIComponent(path)}`
  const encoded = path.split('/').filter(segment => segment.length > 0).map(segment => encodeURIComponent(segment)).join('/')
  return `/files/workspace/${encoded}`
}
