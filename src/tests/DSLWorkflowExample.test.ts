/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { v4 as uuid4 } from 'uuid';
import { DSLWorkflowExample } from './testWorkflows/DSLWorkflowExample';
import { DSL } from '../workflows/DSLInterpreter';
import { setup } from './setup';

describe('DSLWorkflowExample', () => {
  let execute;

  beforeAll(async () => {
    await setup();
    jest.setTimeout(30000);
  });

  beforeEach(() => {
    const client = global.getClient();

    execute = (workflowName: string, exec = 'start', ...args) => {
      const workflowId = `test-${uuid4()}`;
      console.log(`Starting workflow: ${workflowName} with id: ${workflowId}`);

      return client.workflow[exec](workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout: 30000,
        workflowId,
        [exec === 'signalWithStart' ? 'signalArgs' : 'args']: args
      });
    };
  });

  afterAll(async () => {
    await global.shutdown();
    // @ts-ignore
    global.workflowCoverage.mergeIntoGlobalCoverage();
  });

  it('should execute a DSL workflow with a simple activity', async () => {
    // Create a simple DSL definition
    const simpleDSL: DSL = {
      variables: {
        apiUrl: 'https://api.example.com/data'
      },
      root: {
        activity: {
          name: 'makeHTTPRequest',
          arguments: ['apiUrl'],
          result: 'apiResponse'
        }
      }
    };

    // Start the workflow with the DSL
    const handle = await execute('DSLWorkflowExample', 'start', simpleDSL);

    // Wait for completion
    await sleep(1000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify execution result reflects the activity result
    const variables = await handle.query('getVariables');
    expect(variables.apiResponse).toBe('httpResult');
  });

  it('should execute a DSL workflow with a sequence of activities', async () => {
    // Create a DSL with sequential activities
    const sequentialDSL: DSL = {
      variables: {
        apiUrl: 'https://api.example.com/data'
      },
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                arguments: ['apiUrl'],
                result: 'rawData'
              }
            },
            {
              activity: {
                name: 'formatData',
                arguments: ['rawData'],
                result: 'formattedData'
              }
            },
            {
              activity: {
                name: 'processResult',
                arguments: ['formattedData'],
                result: 'finalResult'
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the sequential DSL
    const handle = await execute('DSLWorkflowExample', 'start', sequentialDSL);

    // Wait for completion
    await sleep(2000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify the variables have been updated with activity results
    const variables = await handle.query('getVariables');
    expect(variables.rawData).toBe('httpResult');
    expect(variables.formattedData).toBe('formattedData');
    expect(variables.finalResult).toBe('processedResult');
  });

  it('should allow updating the DSL during execution via signal', async () => {
    // Start with a simple workflow that has a long waiting activity
    // This will give us time to send signals before the workflow completes
    const initialDSL: DSL = {
      variables: { waitTime: '5000' },
      root: {
        activity: {
          name: 'waitForDuration',
          arguments: ['waitTime'],
          result: 'waitResult'
        }
      }
    };

    // Start the workflow
    const handle = await execute('DSLWorkflowExample', 'start', initialDSL);

    // Wait a bit for the workflow to start executing
    await sleep(500);

    // Add activities to the DSL using signals
    await handle.signal('addActivity', {
      name: 'makeHTTPRequest',
      result: 'apiData'
    });

    await sleep(500);

    await handle.signal('addActivity', {
      name: 'formatData',
      arguments: ['apiData'],
      result: 'formattedData'
    });

    // Verify that the DSL was updated
    const updatedDSL = await handle.query('getDSL');
    expect(updatedDSL.root.sequence.elements.length).toBe(2);
    expect(updatedDSL.root.sequence.elements[0].activity.name).toBe('makeHTTPRequest');
    expect(updatedDSL.root.sequence.elements[1].activity.name).toBe('formatData');
  });

  it('should update an entire DSL via signal', async () => {
    // Start with a simple waiting activity to keep the workflow running
    const initialDSL: DSL = {
      variables: { waitTime: '5000' },
      root: {
        activity: {
          name: 'waitForDuration',
          arguments: ['waitTime'],
          result: 'waitResult'
        }
      }
    };

    // Start the workflow
    const handle = await execute('DSLWorkflowExample', 'start', initialDSL);

    await sleep(500);

    // Define a new complete DSL
    const newDSL: DSL = {
      variables: {
        inputData: 'initial_value'
      },
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'processResult',
                arguments: ['inputData'],
                result: 'outputData'
              }
            }
          ]
        }
      }
    };

    // Update the DSL through a signal
    await handle.signal('updateDSL', newDSL);

    // Verify the DSL was updated
    const updatedDSL = await handle.query('getDSL');
    expect(updatedDSL.variables.inputData).toBe('initial_value');
    expect(updatedDSL.root.sequence.elements[0].activity.name).toBe('processResult');
  });
});
