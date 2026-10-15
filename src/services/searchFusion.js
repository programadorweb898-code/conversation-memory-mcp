// Reciprocal-rank fusion keeps lexical candidates eligible even when only part
// of the project has embeddings. Scores from the two engines are not comparable.
function fuseSearchResults(semantic, lexical, limit) {
  const candidates = new Map();
  for (const [rows, source] of [[semantic, "semantic"], [lexical, "lexical"]]) {
    rows.forEach((row, rank) => {
      const id = row.id ?? row.message_id;
      const existing = candidates.get(id);
      const candidate = existing || { ...row, similarity: 0, lexicalRank: Infinity };
      candidate.similarity += 0.5 * 61 / (60 + rank + 1);
      if (source === "lexical") {
        candidate.lexicalRank = rank;
        candidate.lexicalScore = row.lexicalScore ?? Number(row.lexical_score) ?? 0;
      }
      candidates.set(id, candidate);
    });
  }
  return [...candidates.values()]
    .sort((a, b) => b.similarity - a.similarity || a.lexicalRank - b.lexicalRank)
    .slice(0, limit)
    .map(({ lexicalRank, ...row }) => row);
}

module.exports = { fuseSearchResults };
