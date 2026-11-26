import { setup, normalizeCoverage } from './setup';

beforeAll(async () => {
  await setup();
}, 60000);

// Runs after each file's own afterAll hooks, so coverage merged there is normalized before Jest reads it.
afterAll(() => {
  normalizeCoverage();
});
