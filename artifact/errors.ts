/** A malformed, unsafe or incompatible deploy package. Safe to return to the client. */
export class InvalidPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPackageError";
  }
}
