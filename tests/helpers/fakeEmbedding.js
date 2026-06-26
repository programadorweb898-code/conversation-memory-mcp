module.exports = function fakeEmbedding(seed = 0.1) {
  return JSON.stringify(Array(384).fill(seed));
};
