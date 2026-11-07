/** Map the platform-only `sdk` import to the recording stub. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "sdk") return { url: new URL("./sdk-stub.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "sdk/db") return { url: new URL("./sdk-db-stub.mjs", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
