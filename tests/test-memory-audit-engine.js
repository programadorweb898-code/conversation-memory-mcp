/*
  Tests del motor de decisión heurística de memoryAudit.
  Es puro y determinista: no usa LLM ni IO, por lo que estas pruebas no
  necesitan stubs de red ni de Gemini.
*/
const { expect } = require('chai');
const {
  tokenize,
  similarity,
  decideHeuristically,
  verifySourceMessages,
  isValidStatus,
} = require('../src/services/memoryAuditEngine');

describe('Memory Audit Engine', () => {
  describe('tokenize', () => {
    it('normaliza a minúsculas sin acentos', () => {
      expect(tokenize('Motivación para NEON')).to.deep.equal(['motivacion', 'para', 'neon']);
    });

    it('ignora símbolos y espacios', () => {
      expect(tokenize('postgres! (pg) vía $x_y 123')).to.deep.equal(['postgres', 'pg', 'via', 'x', 'y', '123']);
    });

    it('devuelve lista vacía para texto vacío', () => {
      expect(tokenize('')).to.deep.equal([]);
      expect(tokenize(null)).to.deep.equal([]);
    });
  });

  describe('similarity', () => {
    it('devuelve 1 para textos idénticos', () => {
      expect(similarity('usar postgres en neon', 'usar postgres en neon')).to.equal(1);
    });

    it('devuelve 0 para textos sin solapamiento', () => {
      expect(similarity('aaa bbb ccc', 'ddd eee fff')).to.equal(0);
    });

    it('es simétrica y usa contención cuando un set es subconjunto del otro', () => {
      const a = 'a b c d e f';
      const b = 'c d e f g h i j k l';
      expect(similarity(a, b)).to.equal(similarity(b, a));
      expect(similarity(a, b)).to.be.closeTo(0.6667, 0.001);
    });
  });

  describe('decideHeuristically', () => {
    function candidate(overrides = {}) {
      return {
        type: 'decision',
        title: 'a b c d e f',
        what: '',
        why: '',
        whereContext: '',
        learned: '',
        importance: 'medium',
        ...overrides,
      };
    }

    it('missing cuando no hay memorias relacionadas', () => {
      const decision = decideHeuristically(candidate(), []);
      expect(decision.status).to.equal('missing');
      expect(decision.relatedMemories).to.deep.equal([]);
      expect(decision.reason).to.include('relacionadas');
    });

    it('already_exists cuando la memoria es equivalente', () => {
      const memory = {
        id: 'obs-1',
        topicKey: null,
        type: 'decision',
        title: 'a b c d e f',
        content: '',
      };
      const decision = decideHeuristically(candidate(), [memory]);
      expect(decision.status).to.equal('already_exists');
      expect(decision.relatedMemories).to.have.lengthOf(1);
      expect(decision.relatedMemories[0].id).to.equal('obs-1');
    });

    it('possible_duplicate para solapamiento alto pero no equivalente', () => {
      const memory = {
        id: 'obs-2',
        topicKey: 'k',
        type: 'discovery',
        title: 'c d e f',
        content: 'g h i j k l',
      };
      const decision = decideHeuristically(candidate(), [memory]);
      expect(decision.status).to.equal('possible_duplicate');
      expect(decision.relatedMemories[0].topicKey).to.equal('k');
    });

    it('related para solapamiento bajo pero no nulo', () => {
      const memory = {
        id: 'obs-3',
        topicKey: null,
        type: 'configuration',
        title: 'c d',
        content: 'g h i j k l m n',
      };
      const decision = decideHeuristically(candidate(), [memory]);
      expect(decision.status).to.equal('related');
    });

    it('missing cuando el solapamiento es residual pero existe memoria', () => {
      const memory = {
        id: 'obs-4',
        topicKey: null,
        type: 'lesson',
        title: 'c',
        content: 'g h i j k l m n o p',
      };
      const decision = decideHeuristically(candidate(), [memory]);
      expect(decision.status).to.equal('missing');
      expect(decision.relatedMemories).to.have.lengthOf(1);
    });

    it('el bonus de mismo tipo eleva el bucket', () => {
      const memory = {
        id: 'obs-5',
        topicKey: null,
        type: 'decision', // mismo tipo que el candidato
        title: 'c d e f',
        content: 'g h i j',
      };
      const decision = decideHeuristically(candidate(), [memory]);
      // Sin bonus quedaría en possible_duplicate (0.667); con +0.05 supera 0.7.
      expect(decision.status).to.equal('already_exists');
    });

    it('nunca emite conflict', () => {
      const decision = decideHeuristically(candidate(), [
        { id: 'obs-6', type: 'decision', title: 'a b c d e f', content: '' },
      ]);
      expect(decision.status).to.not.equal('conflict');
    });

    it('ordena relatedMemories por score descendente', () => {
      const decision = decideHeuristically(candidate(), [
        { id: 'obs-a', type: 'decision', title: 'a b c d e f', content: '' },
        { id: 'obs-b', type: 'lesson', title: 'c d', content: 'g h i j k l' },
      ]);
      expect(decision.relatedMemories[0].score).to.be.at.least(decision.relatedMemories[1].score);
    });
  });

  describe('verifySourceMessages', () => {
    const messages = [{ id: 'msg-real-1' }, { id: 'msg-real-2' }];

    it('rechaza candidatos sin sourceMessageIds', () => {
      const res = verifySourceMessages({ candidate: { sourceMessageIds: [] }, messages });
      expect(res.valid).to.equal(false);
    });

    it('resuelve ids con prefijo msg-', () => {
      const res = verifySourceMessages({ candidate: { sourceMessageIds: ['msg-msg-real-1'] }, messages });
      expect(res.valid).to.equal(true);
      expect(res.traceableIds).to.deep.equal(['msg-real-1']);
    });

    it('rechaza candidatos cuyos ids no existen en la conversación', () => {
      const res = verifySourceMessages({ candidate: { sourceMessageIds: ['msg-hallucinado'] }, messages });
      expect(res.valid).to.equal(false);
    });
  });

  describe('isValidStatus', () => {
    it('acepta solo los estados del pipeline', () => {
      for (const s of ['missing', 'already_exists', 'related', 'possible_duplicate', 'conflict', 'pending', 'discard']) {
        expect(isValidStatus(s)).to.equal(true);
      }
      expect(isValidStatus('unknown')).to.equal(false);
      expect(isValidStatus(null)).to.equal(false);
    });
  });
});