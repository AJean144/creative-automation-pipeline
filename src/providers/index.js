import * as mock from './mock.js';
import * as higgsfield from './higgsfield.js';

// Every provider exposes generate(prompt, opts) -> Promise<Buffer>. Adding one is a new file plus a line here.
const providers = { mock, higgsfield };

export function getProvider(name) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider "${name}". Choose one of: ${Object.keys(providers).join(', ')}`);
  return p;
}
