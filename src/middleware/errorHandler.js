// Creates an Error that carries an HTTP status code.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Unknown /api routes
function notFound(req, res, next) {
  next(httpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// Every error ends up here, so users always get clean JSON.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed JSON body
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
  });
}

module.exports = { httpError, notFound, errorHandler };
