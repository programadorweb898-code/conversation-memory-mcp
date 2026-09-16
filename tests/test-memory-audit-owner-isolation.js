const { expect } = require('chai');
const { computeCandidateId } = require('../src/tools/memoryAudit');

describe('Memory Audit owner isolation', () => {
  it('genera candidateId distintos para el mismo candidato cuando cambia el owner', () => {
    const candidate = {
      type: 'decision',
      title: 'usar postgres para el historial',
    };

    const ownerA = computeCandidateId({
      project: 'test',
      sessionId: 'session-1',
      candidate,
      owner: 'owner-a',
    });
    const ownerB = computeCandidateId({
      project: 'test',
      sessionId: 'session-1',
      candidate,
      owner: 'owner-b',
    });

    expect(ownerA).to.be.a('string').with.lengthOf(32);
    expect(ownerB).to.be.a('string').with.lengthOf(32);
    expect(ownerA).to.not.equal(ownerB);
  });

  it('mantiene idempotencia para el mismo owner', () => {
    const candidate = {
      type: 'decision',
      title: 'usar postgres para el historial',
    };

    const first = computeCandidateId({
      project: 'test',
      sessionId: 'session-1',
      candidate,
      owner: 'owner-a',
    });
    const second = computeCandidateId({
      project: 'test',
      sessionId: 'session-1',
      candidate,
      owner: 'owner-a',
    });

    expect(first).to.equal(second);
  });
});
