const { expect } = require('chai');
const request = require('supertest');
const errorHandler = require('../src/errorHandler');

describe('errorHandler security', () => {
  function createApp(error) {
    const express = require('express');
    const app = express();

    app.get('/boom', (req, res, next) => next(error));
    app.use(errorHandler);

    return app;
  }

  it('should not expose internal error messages for 500 responses', async () => {
    const internalError = new Error('password=super-secret database connection failed');
    const response = await request(createApp(internalError)).get('/boom');

    expect(response.status).to.equal(500);
    expect(response.body).to.deep.equal({
      status: 'error',
      statusCode: 500,
      message: 'Internal Server Error',
    });
    expect(JSON.stringify(response.body)).not.to.include('super-secret');
  });

  it('should preserve safe messages for explicit 4xx errors', async () => {
    const error = Object.assign(new Error('Invalid project'), { statusCode: 400 });
    const response = await request(createApp(error)).get('/boom');

    expect(response.status).to.equal(400);
    expect(response.body).to.deep.equal({
      status: 'error',
      statusCode: 400,
      message: 'Invalid project',
    });
  });
});
