export function BorderBeam({ active = true }: { readonly active?: boolean }) {
  return <span className={`border-beam ${active ? "is-active" : ""}`} aria-hidden="true" />;
}
