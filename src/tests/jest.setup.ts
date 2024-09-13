import { setup } from './setup';
import { teardown } from './teardown';

beforeAll(async () => {
  await setup();
}, 30000);

afterAll(async () => {
  await teardown();
}, 30000);
