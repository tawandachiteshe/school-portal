// [".c", ".pdf"] → "a .c file or PDF" (design/Deadlines: "upload a .c file or PDF")
export function acceptedText(exts: string[] | null | undefined): string | null {
  if (!exts?.length) return null
  const words = exts.map((e) => (e === '.pdf' ? 'PDF' : `a ${e} file`))
  if (words[0] === 'PDF') words[0] = 'a PDF'
  return words.join(' or ')
}
