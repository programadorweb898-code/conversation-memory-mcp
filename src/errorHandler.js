// src/errorHandler.js

const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  const message = statusCode >= 500
    ? 'Internal Server Error'
    : (err.message || 'Request Error');

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
  });
};

module.exports = errorHandler;
