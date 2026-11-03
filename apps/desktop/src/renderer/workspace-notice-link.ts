const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workspaceNoticeId(search: string): string | undefined {
  const values = new URLSearchParams(search).getAll("workspaceNotice");
  if (!values.length) return undefined;
  if (values.length !== 1 || !uuid.test(values[0] ?? "")) throw new Error("Некорректная ссылка уведомления Workspace");
  return values[0];
}

export function withoutWorkspaceNotice(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("workspaceNotice");
  return `${url.pathname}${url.search}${url.hash}`;
}
