'use strict';

function loongBoardContextHook(context) {
  if (!context || !context.state) return null;
  if (context.state._loongBoardContextAdded) return;
  context.state._loongBoardContextAdded = true;
  return {
    contextAdditions: [{
      source: 'runtime_context',
      title: 'LoongArch runtime constraints',
      content: [
        'LoongArch board runtime uses Node 14, CommonJS, and no npm dependency for loong-agent itself.',
        'Do not run apt full-upgrade, apt install, npm install, g++ installation, or destructive commands.',
        'Do not assume npm or g++ are available; prefer read-only diagnostics and existing files.',
      ].join('\n'),
    }],
    knowledgeEvidence: [],
    warnings: [],
  };
}

module.exports = {
  loongBoardContextHook,
};
