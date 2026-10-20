export function overdueDays(due: string | null, today: string): number {
  if (!due || due >= today) return 0;
  return Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
}
