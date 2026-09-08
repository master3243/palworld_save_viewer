const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Display Unreal DateTime ticks as a local date; keep the row's raw value for sorting. */
export function formatOwnedTime(value: string): string {
  if (!value.trim()) return '';
  // Unreal DateTime counts 100-nanosecond ticks since 0001-01-01.
  const date = /^-?\d+$/.test(value)
    ? new Date(Number(value) / 10_000 - 62_135_596_800_000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}
