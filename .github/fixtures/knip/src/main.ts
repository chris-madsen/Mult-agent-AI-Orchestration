import { used } from './feature.js';

const pluginName = 'runtime-loaded';
void import(`./plugins/${pluginName}.js`);
used();
