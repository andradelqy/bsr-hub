'use strict';

// A durable, globally serialized publication. This is a recoverable journal,
// not a claim that multiple Parse saves form a database transaction.
module.exports = function createPublicationCoordinator(Parse) {
  const options = { useMasterKey:true };
  async function gate() {
    const config = await Parse.Config.get(options);
    const id = config.get('BSR_RATING_GATE_ID');
    if (!id) throw new Error('Inicialize a publicação segura de ratings no Cloud Job initializeRatingPublication antes de publicar.');
    return new Parse.Query('RatingPublicationGate').get(id, options);
  }
  async function run(importKey, action) {
    const lock = await gate();
    lock.increment('workers', 1);
    // Parse returns the result of the atomic increment. Never steal a lock by
    // age: a slow worker may still be applying a snapshot.
    await lock.save(null, options);
    if (lock.get('workers') !== 1) {
      lock.increment('workers', -1);
      await lock.save(null, options);
      throw new Error('Outra publicação está em andamento. Aguarde a conclusão.');
    }
    try {
      const active = lock.get('activeImport');
      if (active && active !== importKey) throw new Error(`Publicação pendente (${active}). Retome essa importação antes de publicar outra corrida.`);
      lock.increment('sequence',1);
      await lock.save(null,options);
      const result = await action(async () => {
        lock.set('activeImport', importKey);
        await lock.save(null, options);
      }, lock.get('sequence'));
      lock.unset('activeImport');
      await lock.save(null, options);
      return result;
    } finally {
      lock.increment('workers', -1);
      await lock.save(null, options);
    }
  }
  async function initialize() {
    const config = await Parse.Config.get(options);
    if (config.get('BSR_RATING_GATE_ID')) return { initialized:true, existing:true };
    const object = new Parse.Object('RatingPublicationGate');
    object.set({ workers:0, sequence:0 });
    object.setACL(new Parse.ACL());
    await object.save(null, options);
    // Run this administrative bootstrap once, never concurrently.
    await Parse.Config.save({ BSR_RATING_GATE_ID:object.id }, { BSR_RATING_GATE_ID:true });
    return { initialized:true, existing:false };
  }
  async function assertReadable() {
    const config = await Parse.Config.get(options);
    if (!config.get('BSR_RATING_GATE_ID')) return;
    const lock = await gate();
    if (lock.get('activeImport')) throw new Error('Ratings em atualização. Aguarde a conclusão ou retomada da publicação pela organização.');
  }
  return { run, initialize, assertReadable };
};
