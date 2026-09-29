// Keep the window alive until saving succeeds or the user explicitly discards.
module.exports = function createQuitController({ flush, close, confirmDiscard, quit, onError }) {
  let pending = false;
  let ready = false;
  return {
    get ready() { return ready; },
    async request(event) {
      if (ready) return;
      event.preventDefault();
      if (pending) return;
      pending = true;
      try {
        try {
          await flush();
        } catch (error) {
          onError(error);
          if (!(await confirmDiscard(error))) return;
        }
        try {
          await close();
        } catch (error) {
          onError(error);
        }
        ready = true;
        quit();
      } catch (error) {
        onError(error);
      } finally {
        pending = false;
      }
    },
  };
};
