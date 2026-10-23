#!/usr/bin/env node
process.env.ACE_CONTEXT_BRIDGE_MODE = 'true';
await import('./ace-mcp.js');
