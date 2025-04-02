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
        workflowExecutionTimeout: 120000,
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
    await sleep(2500);

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

  it('should execute a DSL workflow with a workflow step', async () => {
    // Create a DSL with a workflow step
    const stepDSL: DSL = {
      variables: {
        inputData: 'test_data'
      },
      root: {
        step: {
          name: 'transformData',
          arguments: ['inputData'],
          result: 'transformedData'
        }
      }
    };

    // Start the workflow with the step DSL
    const handle = await execute('DSLWorkflowExample', 'start', stepDSL);

    // Wait for completion
    await sleep(1000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify execution result reflects the step result
    const variables = await handle.query('getVariables');
    expect(variables.transformedData).toBe('transformed_test_data');
  });

  it('should execute a sequence of workflow steps', async () => {
    // Create a DSL with sequential steps
    const sequentialStepsDSL: DSL = {
      variables: {
        inputData: 'valid_data'
      },
      root: {
        sequence: {
          elements: [
            {
              step: {
                name: 'transformData',
                arguments: ['inputData'],
                result: 'transformedData'
              }
            },
            {
              step: {
                name: 'validateData',
                arguments: ['transformedData'],
                result: 'isValid'
              }
            },
            {
              step: {
                name: 'formatOutput',
                arguments: ['transformedData', 'true'],
                result: 'finalOutput'
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the sequential steps DSL
    const handle = await execute('DSLWorkflowExample', 'start', sequentialStepsDSL);

    // Wait for completion
    await sleep(2000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify the variables have been updated with step results
    const variables = await handle.query('getVariables');
    expect(variables.transformedData).toBe('transformed_valid_data');
    expect(variables.isValid).toBe(true);
    expect(variables.finalOutput).toBe('formatted_transformed_valid_data');
  });

  it('should execute a mix of activities and workflow steps', async () => {
    // Create a DSL with a mix of activities and steps
    const mixedDSL: DSL = {
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
                result: 'apiData'
              }
            },
            {
              step: {
                name: 'transformData',
                arguments: ['apiData'],
                result: 'transformedData'
              }
            },
            {
              step: {
                name: 'validateData',
                arguments: ['transformedData'],
                result: 'isValid'
              }
            },
            {
              activity: {
                name: 'processResult',
                arguments: ['transformedData', 'isValid'],
                result: 'finalResult'
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the mixed DSL
    const handle = await execute('DSLWorkflowExample', 'start', mixedDSL);

    // Wait for completion
    await sleep(2000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify the variables have been updated with both activity and step results
    const variables = await handle.query('getVariables');
    expect(variables.apiData).toBe('httpResult');
    expect(variables.transformedData).toBe('transformed_httpResult');
    expect(variables.isValid).toBe(true);
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

  it('should add workflow steps via signals', async () => {
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

    // Wait a bit for the workflow to start executing
    await sleep(500);

    // Add a step using the signal
    await handle.signal('addStep', {
      name: 'transformData',
      arguments: ['waitResult'],
      result: 'transformedData'
    });

    await sleep(500);

    // Add another step
    await handle.signal('addStep', {
      name: 'validateData',
      arguments: ['transformedData'],
      result: 'isValid'
    });

    // Verify that steps were added to the DSL
    const updatedDSL = await handle.query('getDSL');
    expect(updatedDSL.root.sequence.elements.length).toBe(2);
    expect(updatedDSL.root.sequence.elements[0].step.name).toBe('transformData');
    expect(updatedDSL.root.sequence.elements[1].step.name).toBe('validateData');
  });

  it('should execute a parallel combination of activities and steps', async () => {
    // Create a DSL with parallel activities and steps
    const parallelDSL: DSL = {
      variables: {
        apiUrl: 'https://api.example.com/data',
        initialData: 'raw_input'
      },
      root: {
        sequence: {
          elements: [
            {
              parallel: {
                branches: [
                  {
                    activity: {
                      name: 'makeHTTPRequest',
                      arguments: ['apiUrl'],
                      result: 'apiData'
                    }
                  },
                  {
                    step: {
                      name: 'transformData',
                      arguments: ['initialData'],
                      result: 'transformedData'
                    }
                  }
                ]
              }
            },
            {
              step: {
                name: 'formatOutput',
                arguments: ['transformedData', 'true'],
                result: 'finalOutput'
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the parallel DSL
    const handle = await execute('DSLWorkflowExample', 'start', parallelDSL);

    // Wait for completion
    await sleep(2000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify the variables have been updated with both activity and step results
    const variables = await handle.query('getVariables');
    expect(variables.apiData).toBe('httpResult');
    expect(variables.transformedData).toBe('transformed_raw_input');
    expect(variables.finalOutput).toBe('formatted_transformed_raw_input');
  });

  it('should execute a workflow with a long-running activity', async () => {
    // Create a DSL with a long-running activity
    const longRunningDSL: DSL = {
      variables: {
        waitTime: '30000' // 3 seconds wait time
      },
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'waitForDuration',
                arguments: ['waitTime'],
                result: 'waitResult'
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the long-running activity DSL
    const handle = await execute('DSLWorkflowExample', 'start', longRunningDSL);

    // Wait for completion (should take at least 3 seconds)
    await sleep(35000);

    // Check workflow status
    const status = await handle.query('getStatus');
    expect(status.status).toBe('completed');

    // Verify the result
    const variables = await handle.query('getVariables');
    expect(variables.waitResult).toBe('waitResult');
  }, 40000);

  it('should execute a workflow with a long-running workflow step', async () => {
    // Create a DSL with a long-running workflow step
    const longRunningStepDSL: DSL = {
      variables: {
        sleepTime: '30000' // 30 seconds sleep time
      },
      root: {
        sequence: {
          elements: [
            {
              step: {
                name: 'sleepStep',
                arguments: ['sleepTime'],
                result: 'sleepResult'
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the long-running step DSL
    const handle = await execute('DSLWorkflowExample', 'start', longRunningStepDSL);

    // Wait for completion (should take at least 3 seconds)
    await sleep(35000);

    // Check workflow status
    const status = await handle.query('getStatus');
    console.log(status);
    expect(status.status).toBe('completed');

    // Verify the result
    const variables = await handle.query('getVariables');
    expect(variables.sleepResult).toBe('slept for 30000ms');
  }, 40000);
});
