import { Runtime } from '@temporalio/worker';
export default async function () {
  console.log(`Shutting down temporal runtime...`);
  Runtime.instance().shutdown();
}
