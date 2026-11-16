// Stone worker: grows volumes and meshes off the main thread, so the bench
// never stutters while a saw cut is being worked out.
import { makeField } from './gen.js';
import { bakeVolume, VOL_N } from './bake.js';
import { meshPiece } from './mesher.js';

const fields = new Map();
const fieldOf = (id, def) => {
  let f = fields.get(id);
  if (!f) { f = makeField(def); fields.set(id, f); }
  return f;
};
const meshBuffers = (m) => [m.positions.buffer, m.normals.buffer, m.normals0.buffer, m.depth.buffer, m.cap.buffer, m.indices.buffer];

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'grow') {
      const field = fieldOf(m.id, m.def);
      const baked = bakeVolume(field, VOL_N);
      const mesh = meshPiece(field, { planes: [] }, []);
      const c = baked.cells;
      self.postMessage({ req: m.req, baked, mesh }, [
        baked.texA.buffer, baked.texB.buffer, c.index.buffer, c.pos.buffer, c.frac.buffer, c.z.buffer, c.g.buffer, c.pur.buffer,
        c.yel.buffer, c.blk.buffer, c.cot.buffer, c.sh.buffer, c.depth.buffer, c.crack.buffer, ...meshBuffers(mesh),
      ]);
    } else if (m.type === 'mesh') {
      const field = fieldOf(m.id, m.def);
      const meshes = m.pieces.map((p) => meshPiece(field, p, m.windows));
      self.postMessage({ req: m.req, meshes }, meshes.flatMap(meshBuffers));
    } else if (m.type === 'drop') {
      fields.delete(m.id);
    }
  } catch (err) {
    self.postMessage({ req: m.req, error: String(err && err.stack ? err.stack : err) });
  }
};
