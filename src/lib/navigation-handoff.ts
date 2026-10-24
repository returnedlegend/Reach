import type { SelectedLocation } from "@/components/location-picker";

// One-use, short-lived memory only. Precise coordinates never enter a URL,
// browser history, localStorage, or a server-rendered page's props.
let pending: {
  id: string;
  origin: SelectedLocation | null;
  expires: number;
} | null = null;
export function offerNavigationOrigin(
  id: string,
  origin: SelectedLocation | null,
) {
  pending = { id, origin, expires: Date.now() + 60_000 };
}
export function takeNavigationOrigin(id: string): SelectedLocation | null {
  const value = pending;
  pending = null;
  return value?.id === id && value.expires > Date.now() ? value.origin : null;
}
