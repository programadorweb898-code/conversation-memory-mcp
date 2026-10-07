const { expect } = require("chai");
const embeddingService = require("../src/services/embeddingService");
const { db } = require("./test-helper");

describe("Embedding storage contract", function () {
  this.timeout(30000);

  it("mantiene coherentes provider, modelo, dimensión, dtype y versión", async () => {
    const metadata = await embeddingService.assertEmbeddingStorageCompatibility();

    expect(metadata).to.deep.include({
      provider: "transformers.js",
      model: "Xenova/multilingual-e5-small",
      dimensions: 384,
      dtype: "q8",
      version: 1,
    });
  });

  it("rechaza una versión de storage incompatible", async () => {
    await db.runAsync("UPDATE embedding_metadata SET version = 999 WHERE id = 1");

    try {
      await embeddingService.assertEmbeddingStorageCompatibility();
      throw new Error("Expected embedding storage mismatch");
    } catch (error) {
      expect(error.code).to.equal("EMBEDDING_STORAGE_MISMATCH");
      expect(error.message).to.match(/version: DB=999 runtime=1/);
    } finally {
      await db.runAsync("UPDATE embedding_metadata SET version = 1 WHERE id = 1");
    }
  });
});
