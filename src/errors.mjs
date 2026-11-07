/** Portable domain error shared by the SQLite store and MCP transports. */
export class KnowledgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KnowledgeError';
    this.code = code;
  }
}
