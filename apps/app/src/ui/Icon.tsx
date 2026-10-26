const raw = import.meta.glob('../../../../packages/design-system/assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const icons: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([p, svg]) => [p.split('/').pop()!.replace('.svg', ''), svg]));

export type IconName = 'today' | 'notes' | 'calendar' | 'inbox' | 'assist' | 'search' | 'settings' | 'plus' | 'check' | 'x' | 'archive' | 'reply'
  | 'star' | 'pin' | 'link' | 'clock' | 'video' | 'location' | 'paperclip' | 'chevron-left' | 'chevron-down' | 'more' | 'send' | 'hash'
  | 'folder' | 'sun' | 'menu' | 'mic' | 'edit' | 'goals';

export function Icon({ name, size = 'nav', className = '' }: { name: IconName; size?: 'sm' | 'nav' | 'tab'; className?: string }) {
  const cls = `ic ${size === 'sm' ? 'ic--sm' : size === 'tab' ? 'ic--tab' : ''} ${className}`;
  return <span className="icwrap" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name].replace('<svg ', `<svg class="${cls}" `) }} />;
}
