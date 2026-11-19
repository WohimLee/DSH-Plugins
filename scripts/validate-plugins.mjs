import { validatedPlugins } from './plugin-lib.mjs';
try {
  const plugins = await validatedPlugins();
  console.log(`Plugin contracts passed (${plugins.length} plugins).`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
