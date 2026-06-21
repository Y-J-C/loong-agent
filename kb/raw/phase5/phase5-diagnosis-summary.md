# Phase 5 RPC Diagnosis Summary

Observed at: 2026-06-21

## Conclusion

Stage 5 validation passed on the Loong Pi board. Local Codex sandbox execution of `node scripts/test-rpc.js` still fails with `spawn EPERM`, but the same source tree on the board passes all six RPC cases. Board RPC behavior should be judged from board evidence, not from the local sandbox restriction.

## Failure Pattern

- Local command: `node scripts/test-rpc.js`
- Local error: `spawn EPERM`
- Original hang mechanism: mock HTTP servers were created before RPC child-process creation entered `try/finally`; synchronous spawn failure could skip cleanup and keep the Node event loop alive.

## Fix Record

- File: `scripts/test-rpc.js`
- Fix: move `createRpcProcess()` and `createLoongAgent()` into `try/finally`; predeclare `rpc` / `agent` as `null`; close them only when created.
- Local result: no hang; fast failure remains `spawn EPERM`.
- Board result: all six RPC cases passed.

## Unknowns

- Whether the local Codex sandbox can be configured to allow this child-process spawn path is pending confirmation.
