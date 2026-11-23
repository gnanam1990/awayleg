#!/usr/bin/env node
import { main } from '../src/cli.js';

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`awayleg: ${err.message}`);
    process.exit(1);
  });
