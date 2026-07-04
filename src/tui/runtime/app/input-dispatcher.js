'use strict';

var input = require('../../input');

function createRuntimeInputDispatcher(options) {
  options = options || {};
  var state = options.state;
  var handleKey = options.handleKey;
  var isStopped = typeof options.isStopped === 'function' ? options.isStopped : function() { return false; };
  var onError = typeof options.onError === 'function' ? options.onError : null;

  async function dispatch(sequence) {
    try {
      var keys = input.parseInputBuffer(state, sequence);
      for (var index = 0; index < keys.length; index += 1) {
        await handleKey(keys[index]);
        if (isStopped()) break;
      }
    } catch (error) {
      if (onError) onError(error);
      else throw error;
    }
    return { consume: true };
  }

  return {
    dispatch: dispatch,
  };
}

module.exports = {
  createRuntimeInputDispatcher: createRuntimeInputDispatcher,
};
