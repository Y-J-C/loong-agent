'use strict';

function loongBoardContextHook(context) {
  if (!context || !context.state || !Array.isArray(context.state.observations)) return;
  if (context.state._loongBoardContextAdded) return;
  context.state._loongBoardContextAdded = true;
  context.state.observations.push({
    loop: context.state.turn || context.loop || 0,
    tool: 'runtime_context',
    reason: 'loong board runtime constraints',
    input: {},
    result: {
      runtime: 'LoongArch board runtime uses Node 14, CommonJS, and no npm dependency for loong-agent itself.',
      safety: 'Do not run apt full-upgrade, apt install, npm install, g++ installation, or destructive commands.',
      portability: 'Do not assume npm or g++ are available; prefer read-only diagnostics and existing files.',
    },
  });
}

module.exports = {
  loongBoardContextHook,
};
