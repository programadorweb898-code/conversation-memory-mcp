function write(stream, args) {
  stream.write(`${args.map((value) => typeof value === "string" ? value : String(value)).join(" ")}\n`);
}

module.exports = {
  log: (...args) => write(process.stderr, args),
  error: (...args) => write(process.stderr, args),
};