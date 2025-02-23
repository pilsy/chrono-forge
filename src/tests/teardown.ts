import { Runtime } from '@temporalio/worker';
// import { getExporter } from '../utils/instrumentation';

// Teardown shared resources
export const teardown = async () => {
  console.log(`Shutting down temporal runtime...`);

  // // await getExporter('temporal_worker')?.forceFlush();
  // await global.shutdown();
  // try {
  // global.workflowCoverage.mergeIntoGlobalCoverage();
  // } catch (error) {
  //   // console.error(error);
  // }
  // jest.clearAllTimers();
  // Runtime.instance().shutdown();
  process.removeAllListeners();
};

export default teardown;
