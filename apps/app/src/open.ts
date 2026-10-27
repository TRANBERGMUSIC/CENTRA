/** Opens a link outside CENTRA: in the Mac app through the system (browser, Mail, System Settings), else a new tab. */
export async function openExternal(url: string) {
  if ('__TAURI_INTERNALS__' in window) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    return openUrl(url);
  }
  window.open(url, '_blank', 'noopener');
}
