/**
 * Node half of the composer download entry. The browser half in `src/client/`
 * owns the contribution; this entry exists so the package appears as an
 * ordinary Loader row.
 * @module @deepseek-ai/dsh-client-ui-download
 */

/** Loader-visible no-op body; the browser half carries the feature. */
export function apply(): void {}
