// A parse failure (invalid JSON) and a valid parse of a non-object (null, a
// bare number, a bare string, ...) must both be treated as "no usable body" so
// field checks on the result can never throw.
export async function readJsonBody(request) {
  const body = await request.json().catch(() => null)
  return typeof body === 'object' && body !== null ? body : {}
}
