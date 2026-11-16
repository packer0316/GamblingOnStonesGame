// Main-thread side of the stone workers: promises in, typed arrays out.

export function createFactory(count = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))) {
  const workers = [];
  const pending = new Map();
  const home = new Map(); // stone id -> worker that holds its field
  let nextReq = 1, nextWorker = 0;

  for (let i = 0; i < count; i++) {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const job = pending.get(e.data.req);
      if (!job) return;
      pending.delete(e.data.req);
      if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data);
    };
    w.onerror = (e) => console.error('stone worker', e.message);
    workers.push(w);
  }

  const call = (w, msg) => new Promise((resolve, reject) => {
    const req = nextReq++;
    pending.set(req, { resolve, reject });
    w.postMessage({ ...msg, req });
  });

  return {
    /** Bake a stone's volume and its first mesh. */
    grow(id, def) {
      const w = workers[nextWorker++ % workers.length];
      home.set(id, w);
      return call(w, { type: 'grow', id, def });
    },
    /** Mesh sawn pieces of a stone that has been grown. */
    async mesh(id, def, pieces, windows) {
      const w = home.get(id) || workers[0];
      return (await call(w, { type: 'mesh', id, def, pieces, windows })).meshes;
    },
    drop(id) {
      const w = home.get(id);
      if (w) { w.postMessage({ type: 'drop', id }); home.delete(id); }
    },
  };
}
