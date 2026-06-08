'use strict';

const { createAgentSession } = require('./agent-session');

async function runAgent(config, userPrompt, options) {
  const session = createAgentSession(config, options || {});
  return session.prompt(userPrompt);
}

module.exports = {
  createAgentSession,
  runAgent,
};
