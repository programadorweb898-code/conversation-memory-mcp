const { expect } = require('chai');
const sinon = require('sinon');

const { db } = require('./test-helper');
const saveMessage = require('../src/tools/saveMessage');

const PROJECT_A = 'session-identity-project-a';
const PROJECT_B = 'session-identity-project-b';
const OWNER_A = 'session-identity-owner-a';
const OWNER_B = 'session-identity-owner-b';

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('Identidad de sesión y concurrencia', () => {
  const createdSessions = [];

  beforeEach(() => {
    sinon.stub(require('../src/services/embeddingQueue'), 'addTask').returns();
  });

  afterEach(async () => {
    sinon.restore();
    for (const sessionId of createdSessions) {
      await db.runAsync(`DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM conversations WHERE session_id = $1)`, [sessionId]);
      await db.runAsync(`DELETE FROM conversations WHERE session_id = $1`, [sessionId]);
      await db.runAsync(`DELETE FROM session_summary_embeddings WHERE session_id = $1`, [sessionId]);
      await db.runAsync(`DELETE FROM session_summaries WHERE session_id = $1`, [sessionId]);
    }
    createdSessions.length = 0;
  });

  it('permite escrituras concurrentes del mismo owner/proyecto sin perder mensajes', async () => {
    const sessionId = uniqueId('same-identity');
    createdSessions.push(sessionId);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        saveMessage({
          sessionId,
          project: PROJECT_A,
          role: 'user',
          content: `mensaje concurrente ${index}`,
          owner: OWNER_A,
        })
      )
    );

    expect(results).to.have.lengthOf(50);
    expect(results.every((result) => result.success)).to.equal(true);

    const rows = await db.allAsync(
      `SELECT project, owner, content FROM conversations WHERE session_id = $1`,
      [sessionId]
    );

    expect(rows).to.have.lengthOf(50);
    expect(new Set(rows.map((row) => row.project))).to.deep.equal(new Set([PROJECT_A]));
    expect(new Set(rows.map((row) => row.owner))).to.deep.equal(new Set([OWNER_A]));
  });

  it('evita que escrituras concurrentes mezclen el mismo session_id entre proyectos', async () => {
    const sessionId = uniqueId('cross-project');
    createdSessions.push(sessionId);

    const attempts = [
      ...Array.from({ length: 20 }, (_, index) => ({ project: PROJECT_A, content: `A-${index}` })),
      ...Array.from({ length: 20 }, (_, index) => ({ project: PROJECT_B, content: `B-${index}` })),
    ];

    const settled = await Promise.allSettled(
      attempts.map(({ project, content }) =>
        saveMessage({ sessionId, project, role: 'user', content, owner: OWNER_A })
      )
    );

    const successes = settled.filter((result) => result.status === 'fulfilled');
    const failures = settled.filter((result) => result.status === 'rejected');

    expect(successes).to.have.lengthOf(20);
    expect(failures).to.have.lengthOf(20);
    expect(failures.every((result) => result.reason.code === 'PROJECT_CONFLICT')).to.equal(true);

    const rows = await db.allAsync(
      `SELECT DISTINCT project, owner FROM conversations WHERE session_id = $1`,
      [sessionId]
    );

    expect(rows).to.have.lengthOf(1);
    expect(rows[0].owner).to.equal(OWNER_A);
    expect([PROJECT_A, PROJECT_B]).to.include(rows[0].project);
  });

  it('evita que escrituras concurrentes mezclen el mismo session_id entre owners', async () => {
    const sessionId = uniqueId('cross-owner');
    createdSessions.push(sessionId);

    const attempts = [
      ...Array.from({ length: 20 }, (_, index) => ({ owner: OWNER_A, content: `A-${index}` })),
      ...Array.from({ length: 20 }, (_, index) => ({ owner: OWNER_B, content: `B-${index}` })),
    ];

    const settled = await Promise.allSettled(
      attempts.map(({ owner, content }) =>
        saveMessage({ sessionId, project: PROJECT_A, role: 'user', content, owner })
      )
    );

    const successes = settled.filter((result) => result.status === 'fulfilled');
    const failures = settled.filter((result) => result.status === 'rejected');

    expect(successes).to.have.lengthOf(20);
    expect(failures).to.have.lengthOf(20);
    expect(failures.every((result) => result.reason.code === 'OWNER_CONFLICT')).to.equal(true);

    const rows = await db.allAsync(
      `SELECT DISTINCT project, owner FROM conversations WHERE session_id = $1`,
      [sessionId]
    );

    expect(rows).to.have.lengthOf(1);
    expect(rows[0].project).to.equal(PROJECT_A);
    expect([OWNER_A, OWNER_B]).to.include(rows[0].owner);
  });
});
