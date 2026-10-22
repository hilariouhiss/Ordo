export function daysSince(from: string | null, today: string): number {
  if (!from || from >= today) return 0;
  return Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000);
}

export function overdueDays(due: string | null, today: string): number {
  return daysSince(due, today);
}
