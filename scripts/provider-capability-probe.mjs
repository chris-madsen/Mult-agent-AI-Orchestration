import { buildProviderReport, isMain } from './provider-capability-probe-lib.mjs';

if (isMain(import.meta.url)) {
  const report = await buildProviderReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
