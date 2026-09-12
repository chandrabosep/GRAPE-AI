// The deployed function, kept as plain JavaScript on purpose.
//
// Vercel compiles a .ts entrypoint to real ESM, where Node requires a file
// extension on every relative import — so `../src/app` resolved to nothing and
// the function died before it could answer. Extensions alone would not have
// saved it either: @aam/db, @aam/shared and @aam/ai-provider are consumed as
// TypeScript source, and Node will not strip types from node_modules.
//
// The build bundles the handler and everything it imports into one file, which
// leaves nothing for Node to resolve and nothing for Vercel to compile.
export { default } from '../dist/handler.js';
