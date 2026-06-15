#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDefaultToolRegistry } = require('../src/tool-registry');

async function main() {
  const outputDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'loong-agent-tool-verify'));
  const registry = createDefaultToolRegistry();
  const config = {
    workspace: process.cwd(),
    provider: 'verify-pi-file-tools',
  };
  const script = path.join(outputDir, 'pi_tool_probe.js');
  const csv = path.join(outputDir, 'pi_tool_probe.csv');
  const content = [
    "'use strict';",
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(csv)}, 'temperature,pressure\\n25.3,1008.6\\n', 'utf8');`,
    '',
  ].join('\n');

  const write = await registry.execute(config, 'write', { path: script, content });
  const bash = await registry.execute(config, 'bash', { command: `node ${JSON.stringify(script)}` });
  const read = bash.exitCode === 0
    ? await registry.execute(config, 'read', { path: csv })
    : null;

  const result = {
    ok: bash.exitCode === 0 && Boolean(read && /temperature,pressure/.test(read.data.content)),
    outputDir,
    script: write.data,
    bash: {
      exitCode: bash.exitCode,
      stderr: bash.stderr,
      timedOut: bash.timedOut,
    },
    csv: read ? read.data.content : '',
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
