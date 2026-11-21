/** Root Jest config: every workspace package/app with a jest.config.js becomes a project. */
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');

const projects = ['packages', 'apps'].flatMap((group) => {
  const dir = path.join(__dirname, group);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => path.join(dir, name, 'jest.config.js'))
    .filter((config) => existsSync(config));
});

/** @type {import('jest').Config} */
module.exports = { projects };
