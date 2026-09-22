export const allowedViews = ['dashboard','materials','office-inventory','locations','scanner','issues','users','scans','checklist','samples-report'] as const;
export type View = typeof allowedViews[number];
type Role = 'ADMIN' | 'SCANNER';

export function resolveView(search: string, role: Role): View {
  if (role === 'SCANNER') return 'scanner';
  const candidate = new URLSearchParams(search).get('view');
  return allowedViews.includes(candidate as View) ? candidate as View : 'dashboard';
}

export function viewUrl(href: string, view: View, role: Role): string {
  const url = new URL(href);
  url.searchParams.set('view', view);
  url.searchParams.set('view', resolveView(url.search, role));
  return `${url.pathname}${url.search}${url.hash}`;
}
