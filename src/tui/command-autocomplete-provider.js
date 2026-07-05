'use strict';

const { completeSlashInput } = require('./slash-commands');

function createCommandAutocompleteProvider(defaultContext) {
  return {
    complete: function complete(input, context) {
      return completeSlashInput(input, context || defaultContext || {});
    },
  };
}

const defaultProvider = createCommandAutocompleteProvider();

function completeCommandInput(input, context) {
  return defaultProvider.complete(input, context);
}

module.exports = {
  completeCommandInput,
  createCommandAutocompleteProvider,
};
