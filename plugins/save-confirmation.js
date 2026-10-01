function extractConfirmedMessageId(result) {
  if (result?.isError) {
    const errorText = (result?.content ?? [])
      .map((c) => c?.text ?? "")
      .join("")
      .trim()
    throw new Error(errorText || "saveMessage devolvió un error")
  }

  const text = (result?.content ?? [])
    .map((c) => c?.text ?? "")
    .join("")
  const match = text.match(/ID:\s*(\S+)/)

  if (!match?.[1]) {
    throw new Error("saveMessage no devolvió un ID de mensaje")
  }

  return match[1]
}

module.exports = { extractConfirmedMessageId }
