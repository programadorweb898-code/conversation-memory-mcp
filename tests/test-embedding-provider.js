const { expect } = require("chai");
const {
  EmbeddingInfrastructureError,
  createTransformersEmbeddingProvider,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
  DEFAULT_DTYPE,
} = require("../src/services/embeddingProviders/transformersProvider");

function vector(start, length = DEFAULT_DIMENSIONS) {
  return Array.from({ length }, (_, index) => start + index / 10000);
}

describe("Embedding Provider", function () {
  this.timeout(15000);

  it("expone metadatos del proveedor concreto", () => {
    const provider = createTransformersEmbeddingProvider({
      loadTransformers: async () => ({
        pipeline: async () => async () => ({
          data: vector(0.1),
        }),
      }),
    });

    expect(provider.getMetadata()).to.deep.equal({
      provider: "transformers.js",
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      dtype: DEFAULT_DTYPE,
    });
  });

  it("genera un embedding y mantiene el contrato de dimensiones", async () => {
    let receivedOptions;
    let receivedText;

    const provider = createTransformersEmbeddingProvider({
      loadTransformers: async () => ({
        pipeline: async () => {
          return async (text, extractorOptions) => {
            receivedText = text;
            receivedOptions = extractorOptions;
            return { data: vector(0.2) };
          };
        },
      }),
    });

    const result = await provider.embed("user: mensaje de prueba");

    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.have.lengthOf(DEFAULT_DIMENSIONS);
    expect(result[0].every((value) => Number.isFinite(value))).to.equal(true);
    expect(receivedText).to.equal("user: mensaje de prueba");
    expect(receivedOptions).to.deep.equal({ pooling: "mean", normalize: true });
  });

  it("genera un lote como vectores separados sin exponer el formato interno de Transformers.js", async () => {
    const first = vector(0.3);
    const second = vector(0.4);

    const provider = createTransformersEmbeddingProvider({
      loadTransformers: async () => ({
        pipeline: async () => async () => ({
          data: [...first, ...second],
        }),
      }),
    });

    const result = await provider.embed(["uno", "dos"]);

    expect(result).to.have.lengthOf(2);
    expect(result[0]).to.deep.equal(first);
    expect(result[1]).to.deep.equal(second);
  });

  it("rechaza una salida con una dimensión incompatible", async () => {
    const provider = createTransformersEmbeddingProvider({
      loadTransformers: async () => ({
        pipeline: async () => async () => ({
          data: vector(0.5, DEFAULT_DIMENSIONS - 1),
        }),
      }),
    });

    let error;
    try {
      await provider.embed("texto");
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include("dimensiones");
  });

  it("reintenta la inicialización después de un fallo de infraestructura", async () => {
    let factoryCalls = 0;
    const provider = createTransformersEmbeddingProvider({
      loadTransformers: async () => {
        factoryCalls += 1;
        if (factoryCalls === 1) {
          throw new Error("offline");
        }

        return {
          pipeline: async () => async () => ({
            data: vector(0.6),
          }),
        };
      },
    });

    let firstError;
    try {
      await provider.initialize();
    } catch (error) {
      firstError = error;
    }

    expect(firstError).to.be.instanceOf(EmbeddingInfrastructureError);
    expect(firstError.code).to.equal("EMBEDDING_INFRASTRUCTURE");
    expect(await provider.embed("texto")).to.have.lengthOf(1);
    expect(factoryCalls).to.equal(2);
  });
});
