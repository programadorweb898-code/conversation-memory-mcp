const { expect } = require('chai');
const searchMessages = require("../src/tools/searchMessages");
const saveMessage = require("../src/tools/saveMessage");
const { db } = require("./test-helper"); // Import the updated helper
const {
  generateEmbedding,
  initializeEmbeddingPipeline,
  saveEmbedding,
} = require("../src/services/embeddingService"); // Import for initialization

describe('Semantic Search Messages Tool', () => {
  const testSessionId = `test-session-semantic-${Date.now()}`;
  const testProject = "semantic-search-project";

  before(async function() {
    this.timeout(30000); // Increased timeout for pipeline + DB operations

    console.log("Initializing embedding pipeline for tests...");
    await initializeEmbeddingPipeline();
    console.log("Embedding pipeline initialized.");

    // Save test messages with diverse content for semantic search
    await saveMessage({ sessionId: testSessionId, project: testProject, role: "user", content: "El coche rojo está aparcado en la calle." });
    await saveMessage({ sessionId: testSessionId, project: testProject, role: "assistant", content: "Un vehículo escarlata se encuentra estacionado en la vía pública." });
    await saveMessage({ sessionId: testSessionId, project: testProject, role: "user", content: "Los perros son mascotas leales y amigables." });
    await saveMessage({ sessionId: testSessionId, project: testProject, role: "assistant", content: "Los gatos prefieren la soledad y son cazadores hábiles." });
    await saveMessage({ sessionId: testSessionId, project: "other-project", role: "user", content: "El precio de las acciones subió hoy." });

    const savedMessages = await db.allAsync(
      `SELECT id, content FROM conversations WHERE session_id = $1`,
      [testSessionId]
    );

    for (const message of savedMessages) {
      const embedding = await generateEmbedding(message.content);
      await saveEmbedding(message.id, embedding);
    }

    console.log("Test messages saved for semantic search.");
  });

  after(async () => {
    // Cleanup: Delete test messages using async/await
    try {
      await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [testSessionId]);
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [testSessionId]);
    } catch (err) {
      console.error("Error cleaning up test data:", err.message);
    }
  });

  it('debería encontrar mensajes semánticamente similares a una consulta', async () => {
    const query = "Automóvil aparcado en la calle.";
    const results = await searchMessages({ query: query, project: testProject });

    expect(results).to.be.an('array');
    expect(results).to.not.be.empty;

    // Expect the most similar messages to be at the top
    const topResultContent = results[0].content;
    expect(topResultContent).to.satisfy(content => 
      content.includes("coche rojo") || content.includes("vehículo escarlata")
    );
    
    // Ensure the results are sorted by similarity (descending)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).to.be.gte(results[i+1].similarity);
    }
  }).timeout(10000); // Increased timeout for semantic search

  it('debería filtrar los resultados por proyecto correctamente', async () => {
    const query = "perros y gatos";
    const results = await searchMessages({ query: query, project: testProject });

    expect(results).to.be.an('array');
    expect(results).to.have.lengthOf(2); // Expect only the two messages about pets
    expect(results.every(r => r.project === testProject)).to.be.true;

    // Ensure the pets messages are present
    const contents = results.map(r => r.content);
    expect(contents).to.include("Los perros son mascotas leales y amigables.");
    expect(contents).to.include("Los gatos prefieren la soledad y son cazadores hábiles.");
  }).timeout(10000);

  it('no debería encontrar mensajes de otros proyectos al filtrar', async () => {
    const query = "precio de acciones";
    const results = await searchMessages({ query: query, project: testProject }); // Search in testProject

    expect(results).to.be.an('array');
    expect(results).to.be.empty; // Should not find the message from "other-project"
  }).timeout(10000);
});
