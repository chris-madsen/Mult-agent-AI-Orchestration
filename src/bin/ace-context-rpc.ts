#!/usr/bin/env node
process.env.ACE_CONTEXT_RPC_MODE = 'true';
await import('./ace-runtime.js');
