const { expect } = require("chai");
const { EmbeddingInfrastructureError } = require("../src/services/embeddingProvider");
const {
  createTransformersEmbeddingProvider,
  DEFAULT_MODEL,
  DEFAULT_DIMENSIONS,
  DEFAULT_DTYPE,
  INPUT_PREFIXES,
  formatInputText,
} = require("../src/services/embeddingProviders/transformersProvider");

function vector(start, length = DEFAULT_DIMENSIONS) {
  return Array.from({ length }, (_, index) => start + index / 10000);
}

describe("Embedding Provider", function () {
  this.timeout(15000);

  it("usa el modelo multilingüe E5 de 384 dimensiones", () => {
    const provider = createTransformersEmbeddingProvider();
    const metadata = provider.getMetadata();

    expect(metadata).to.deep.equal({
      provider: "transformers.js",
      model: "Xenova/multilingual-e5-small",
      dimensions: 384,
      dtype: DEFAULT_DTYPE,
    });
    expect(metadata.model).to.equal(DEFAULT_MODEL);
    expect(metadata.dimensions).to.equal(DEFAULT_DIMENSIONS);
  });

  it("expone los prefijos E5 para queries y passages", () => {
    expect(formatInputText("¿Qué decidimos?", "query")).to.equal(
      INPUT_PREFIXES.query + "¿Qué decidimos?",
    );
    expect(formatInputText("Decidimos usar PostgreSQL.", "passage")).to.equal(
      INPUT_PREFIXES.passage + "Decidimos usar PostgreSQL.",
    );
  });

  it("rechaza un tipo de entrada desconocido", () => {
    expect(() => formatInputText("texto", "unknown")).to.throw(
      "Tipo de entrada de embedding no soportado",
    );
  });

  it("genera un embedding y aplica el prefijo query sin exponer Transformers.js", async () => {
    let receivedText;
    let receivedOptions;

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

    const result = await provider.embed("¿Qué decidimos?", { inputType: "query" });

    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.have.lengthOf(DEFAULT_DIMENSIONS);
    expect(result[0].every((value) => Number.isFinite(value))).to.equal(true);
    expect(receivedText).to.equal(INPUT_PREFIXES.query + "¿Qué decidimos?");
    expect(receivedOptions).to.deep.equal({ pooling: "mean", normalize: true });
  });

  it("genera un lote como passages separados", async () => {
    const first = vector(0.3);
    const second = vector(0.4);

    const provider = createTransformersEmbeddingProvider({
      loadTransformers: async () => ({
        pipeline: async () => async (texts) => ({
          data: [...first, ...second],
        }),
      }),
    });

    const result = await provider.embed(["uno", "dos"], { inputType: "passage" });

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
