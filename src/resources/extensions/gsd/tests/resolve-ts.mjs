import { registerHooks } from 'node:module';
import * as distRedirect from './dist-redirect.mjs';

// Register hook to redirect imports to the dist directory
registerHooks({
  resolve: distRedirect.resolve,
  load: distRedirect.load,
});
