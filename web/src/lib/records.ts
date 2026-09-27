// Money as the design writes it: "310.00", "−310.00" (true minus sign).
export function money(amount: string | number): string {
  const n = Number(amount)
  const s = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `−${s}` : s
}

// A calendar date string ("2027-03-31") as a Date at noon in Harare, safe from timezone drift.
export const onDay = (ymd: string) => new Date(`${ymd}T12:00:00+02:00`)
