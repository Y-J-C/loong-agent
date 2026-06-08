'use strict';

function createEventBus() {
  const listeners = [];

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Event listener must be a function');
    }
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  async function emit(event) {
    const snapshot = listeners.slice();
    for (const listener of snapshot) {
      try {
        await listener(event);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        console.warn(`Agent event listener failed: ${message}`);
      }
    }
  }

  return {
    emit,
    subscribe,
  };
}

module.exports = {
  createEventBus,
};
