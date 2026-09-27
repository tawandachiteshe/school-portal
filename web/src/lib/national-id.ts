// Zimbabwe National ID: RR-SSSSSS(S) L OO, check letter = LETTERS[int(RR+SERIAL) % 23]
// (api/app/ocr/national_id.py; the server checks again).
const LETTERS = 'ZABCDEFGHJKLMNPQRSTVWXY'
const ID_RE = /(\d{2})\s*-?\s*(\d{6,7})\s*-?\s*([A-HJ-NP-Z])\s*-?\s*(\d{2})/

export type DecodedId = { digits: string; letter: string; origin: string; expected: string; valid: boolean }

export function decodeId(raw: string): DecodedId | null {
  const m = raw.toUpperCase().match(ID_RE)
  if (!m) return null
  const [, reg, serial, letter, origin] = m
  const expected = LETTERS[Number(BigInt(reg + serial) % 23n)]
  return { digits: `${reg}-${serial}`, letter, origin, expected, valid: letter === expected }
}

export const formatId = (d: { digits: string; letter: string; origin: string }) => `${d.digits} ${d.letter} ${d.origin}`
