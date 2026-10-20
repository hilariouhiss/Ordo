export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
export function addDays(iso: string, offset: number): string {
  const date = new Date(iso + "T00:00:00");
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}
