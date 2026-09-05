/*
  Tests del adaptador EngramLocalAdapter.
  La HTTP API de Engram se verifica localmente (GET /health, GET /search). Aquí
  se stubea fetch para que las pruebas sean deterministas y sin dependencias.
*/
const { expect } = require('chai');
const sinon = require('sinon');
const childProcess = require('child_process');
const { EngramLocalAdapter, defaultBaseUrl } = require('../src/services/engramLocalAdapter');

describe('EngramLocalAdapter (MCP local)', () => {
  let fetchStub;

  function makeResponse({ ok = true, status = 200, body } = {}) {
    return { ok, status, json: sinon.stub().resolves(body) };
  }

  function makeAdapter(fetchFn) {
    return new EngramLocalAdapter({ baseUrl: 'http://engram.test', fetchFn });
  }

  beforeEach(() => {
    fetchStub = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('T11.1 — getStatus devuelve disponible con versión cuando /health responde ok', async () => {
    fetchStub.resolves(makeResponse({ body: { service: 'engram', status: 'ok', version: '0.1.0' } }));
    const status = await makeAdapter(fetchStub).getStatus();

    expect(status.available).to.equal(true);
    expect(status.provider).to.equal('engram-local');
    expect(status.version).to.equal('0.1.0');
    expect(fetchStub.getCall(0).args[0]).to.contain('/health');
  });

  it('T11.2 — getStatus responde no disponible si /health devuelve HTTP error', async () => {
    fetchStub.resolves(makeResponse({ ok: false, status: 500, body: {} }));
    const status = await makeAdapter(fetchStub).getStatus();

    expect(status.available).to.equal(false);
    expect(status.error).to.contain('500');
  });

  it('T11.3 — getStatus nunca lanza si el transporte falla', async () => {
    fetchStub.rejects(new Error('connection refused'));
    const status = await makeAdapter(fetchStub).getStatus();

    expect(status.available).to.equal(false);
    expect(status.error).to.contain('connection refused');
  });

  it('T11.4 — searchRelated normaliza las observaciones de la API', async () => {
    fetchStub.resolves(makeResponse({ body: [
      { id: 10, sync_id: 'obs-abc', type: 'decision', title: 'T', content: 'C', project: 'p', scope: 'project', rank: 0.5 },
    ] }));
    const memories = await makeAdapter(fetchStub).searchRelated({ query: 'q', project: 'p' });

    expect(memories).to.have.lengthOf(1);
    expect(memories[0].id).to.equal('obs-abc');
    expect(memories[0].localId).to.equal('10');
    expect(memories[0].topicKey).to.equal(null);
    expect(memories[0].type).to.equal('decision');
    expect(memories[0].title).to.equal('T');
    expect(memories[0].rank).to.equal(0.5);
  });

  it('T11.5 — searchRelated devuelve [] cuando la API responde null (sin resultados)', async () => {
    fetchStub.resolves(makeResponse({ body: null }));
    const memories = await makeAdapter(fetchStub).searchRelated({ query: 'zzz' });

    expect(memories).to.deep.equal([]);
  });

  it('T11.6 — searchRelated lanza si la API responde HTTP error', async () => {
    fetchStub.resolves(makeResponse({ ok: false, status: 400, body: {} }));
    let err;
    try {
      await makeAdapter(fetchStub).searchRelated({ query: 'q' });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an('error');
    expect(err.message).to.contain('400');
  });

  it('T11.7 — searchRelated lanza si el transporte falla', async () => {
    fetchStub.rejects(new Error('ECONNREFUSED'));
    let err;
    try {
      await makeAdapter(fetchStub).searchRelated({ query: 'q' });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an('error');
    expect(err.message).to.contain('ECONNREFUSED');
  });

  it('T11.8 — searchRelated arma los parámetros q, limit y project', async () => {
    fetchStub.resolves(makeResponse({ body: [] }));
    await makeAdapter(fetchStub).searchRelated({ query: 'hola mundo', project: 'proj', limit: 3 });

    const url = fetchStub.getCall(0).args[0];
    expect(url).to.contain('/search?');
    expect(url).to.contain('q=hola+mundo');
    expect(url).to.contain('project=proj');
    expect(url).to.contain('limit=3');
  });

  it('T11.9 — la URL base por defecto es el servidor local', () => {
    const originalUrl = process.env.ENGRAM_HTTP_URL;
    delete process.env.ENGRAM_HTTP_URL;
    try {
      expect(defaultBaseUrl()).to.equal('http://127.0.0.1:7437');
    } finally {
      if (originalUrl !== undefined) process.env.ENGRAM_HTTP_URL = originalUrl;
    }
  });

  it('T11.10 — respeta ENGRAM_PORT para la URL base', () => {
    const originalUrl = process.env.ENGRAM_HTTP_URL;
    const originalPort = process.env.ENGRAM_PORT;
    delete process.env.ENGRAM_HTTP_URL;
    process.env.ENGRAM_PORT = '9999';
    try {
      expect(defaultBaseUrl()).to.equal('http://127.0.0.1:9999');
    } finally {
      if (originalUrl !== undefined) process.env.ENGRAM_HTTP_URL = originalUrl;
      if (originalPort !== undefined) process.env.ENGRAM_PORT = originalPort;
    }
  });
});

describe('EngramLocalAdapter promote (CLI engram save)', () => {
  function stubSave(output, error) {
    return sinon.stub(childProcess, 'execFile').callsFake((file, args, opts, cb) => {
      cb(error || null, output || '', '');
    });
  }

  function makeAdapter() {
    return new EngramLocalAdapter({ baseUrl: 'http://engram.test', fetchFn: sinon.stub() });
  }

  const baseCandidate = {
    project: 'proj',
    sessionId: 's1',
    type: 'decision',
    title: 'elegi postgres en neon',
    topicKey: null,
    what: 'usar postgres',
    why: 'escala',
    whereContext: 'proyecto x',
    learned: 'pg',
  };

  afterEach(() => {
    sinon.restore();
  });

  it('P-A1 — ejecuta engram save con el candidato traducido y devuelve { success:true, memoryId, topicKey, metadata }', async () => {
    const execStub = stubSave('Memory saved: #42 "elegi postgres en neon" (decision)\n');
    const result = await makeAdapter().promote(baseCandidate);

    expect(result).to.deep.equal({ success: true, memoryId: '42', topicKey: null, metadata: {} });
    expect(execStub.calledOnce).to.equal(true);
    const [file, args] = execStub.getCall(0).args;
    expect(file).to.equal('engram');
    expect(args[0]).to.equal('save');
    expect(args).to.include('elegi postgres en neon');
    expect(args).to.include('**What**: usar postgres\n**Why**: escala\n**Where**: proyecto x\n**Learned**: pg');
    expect(args).to.include('--type');
    expect(args[args.indexOf('--type') + 1]).to.equal('decision');
    expect(args).to.include('--project');
    expect(args[args.indexOf('--project') + 1]).to.equal('proj');
  });

  it('P-A2 — envía --topic cuando el candidato tiene topicKey y lo devuelve en la respuesta', async () => {
    const execStub = stubSave('Memory saved: #7 "titulo" (discovery)');
    const result = await makeAdapter().promote({ ...baseCandidate, topicKey: 'arch/memoria' });

    expect(result).to.deep.equal({ success: true, memoryId: '7', topicKey: 'arch/memoria', metadata: {} });
    const args = execStub.getCall(0).args[1];
    expect(args[args.indexOf('--topic') + 1]).to.equal('arch/memoria');
  });

  it('P-A3 — si el contenido está vacío, usa el título como cuerpo', async () => {
    const execStub = stubSave('Memory saved: #3 "solo titulo" (manual)');
    const result = await makeAdapter().promote({ project: 'p', title: 'solo titulo', what: '' });

    expect(result.success).to.equal(true);
    expect(result.memoryId).to.equal('3');
    const args = execStub.getCall(0).args[1];
    expect(args[1]).to.equal('solo titulo');
    expect(args[2]).to.equal('solo titulo');
  });

  it('P-A4 — si el CLI devuelve un error, responde { success:false, retryable:true } sin lanzar', async () => {
    stubSave('', new Error('engram: command not found'));
    const result = await makeAdapter().promote(baseCandidate);

    expect(result.success).to.equal(false);
    expect(result.error).to.contain('Engram save falló');
    expect(result.retryable).to.equal(false);
  });

  it('P-A4b — un fallo temporal del CLI es retryable', async () => {
    stubSave('', new Error('engram daemon: connection refused'));
    const result = await makeAdapter().promote(baseCandidate);

    expect(result.success).to.equal(false);
    expect(result.error).to.contain('Engram save falló');
    expect(result.retryable).to.equal(true);
  });

  it('P-A5 — si la respuesta no se puede interpretar, responde { success:false, retryable:false } sin lanzar', async () => {
    stubSave('Algo inesperado');
    const result = await makeAdapter().promote(baseCandidate);

    expect(result.success).to.equal(false);
    expect(result.error).to.contain('Respuesta inesperada de Engram save');
    expect(result.retryable).to.equal(false);
  });

  it('P-A6 — rechaza un candidato sin título sin invocar el CLI', async () => {
    const execStub = stubSave('Memory saved: #1 "x" (manual)');
    const result = await makeAdapter().promote({ project: 'p', title: '' });

    expect(result.success).to.equal(false);
    expect(result.error).to.contain('título');
    expect(result.retryable).to.equal(false);
    expect(execStub.called).to.equal(false);
  });

  it('P-A1b — acepta options.idempotencyKey sin afectar la operación', async () => {
    const execStub = stubSave('Memory saved: #42 "elegi postgres en neon" (decision)\n');
    const result = await makeAdapter().promote(baseCandidate, { idempotencyKey: 'candidate-123' });

    expect(result.success).to.equal(true);
    expect(result.memoryId).to.equal('42');
    expect(execStub.calledOnce).to.equal(true);
  });

  it('P-A7 — reutiliza una memoria existente con el mismo título en el proyecto (no crea duplicado)', async () => {
    const fetchStub = sinon.stub().resolves({
      ok: true, status: 200,
      json: sinon.stub().resolves([
        { id: 5, sync_id: 'obs-500', type: 'decision', title: 'Elegi Postgres en Neon', project: 'proj' },
      ]),
    });
    const adapter = new EngramLocalAdapter({ baseUrl: 'http://engram.test', fetchFn: fetchStub });
    const execStub = stubSave('Memory saved: #900 "x" (manual)');

    const result = await adapter.promote(baseCandidate);

    expect(result).to.deep.equal({ success: true, memoryId: 'obs-500', topicKey: null, metadata: {} });
    expect(execStub.called).to.equal(false);
    expect(fetchStub.calledOnce).to.equal(true);
    expect(fetchStub.getCall(0).args[0]).to.contain('/search?');
  });

  it('P-A8 — crea la memoria cuando no hay coincidencia exacta de título', async () => {
    const fetchStub = sinon.stub().resolves({
      ok: true, status: 200,
      json: sinon.stub().resolves([
        { id: 1, sync_id: 'obs-1', type: 'decision', title: 'otra cosa distinta', project: 'proj' },
      ]),
    });
    const adapter = new EngramLocalAdapter({ baseUrl: 'http://engram.test', fetchFn: fetchStub });
    const execStub = stubSave('Memory saved: #42 "elegi postgres en neon" (decision)\n');

    const result = await adapter.promote(baseCandidate);

    expect(result).to.deep.equal({ success: true, memoryId: '42', topicKey: null, metadata: {} });
    expect(execStub.calledOnce).to.equal(true);
  });

  it('P-A9 — si la búsqueda previa falla, igual intenta crear la memoria', async () => {
    const fetchStub = sinon.stub().rejects(new Error('ECONNREFUSED'));
    const adapter = new EngramLocalAdapter({ baseUrl: 'http://engram.test', fetchFn: fetchStub });
    const execStub = stubSave('Memory saved: #9 "elegi postgres en neon" (decision)');

    const result = await adapter.promote(baseCandidate);

    expect(result).to.deep.equal({ success: true, memoryId: '9', topicKey: null, metadata: {} });
    expect(execStub.calledOnce).to.equal(true);
  });
});