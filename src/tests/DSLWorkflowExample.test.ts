/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { v4 as uuid4 } from 'uuid';
import { DSLWorkflowExample } from './testWorkflows/DSLWorkflowExample';
import { DSL } from '../workflows/DSLInterpreter';
import { setup } from './setup';
import { DSLDefinition } from '../workflows/DSLInterpreter';

describe('DSLWorkflowExample', () => {
  let execute;

  beforeAll(async () => {
    await setup();
    jest.setTimeout(30000);
  });

  afterAll(async () => {
    await global.shutdown();
    // @ts-ignore
    global.workflowCoverage.mergeIntoGlobalCoverage();
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

  it('should execute a DSL workflow with a simple activity', async () => {
    const simpleDSL: DSLDefinition = {
      variables: {
        apiUrl: 'https://api.example.com/data'
      },
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest',
            with: ['apiUrl'],
            store: 'apiResponse'
          }
        }
      }
    };

    const handle = await execute('DSLWorkflowExample', 'start', { dsl: simpleDSL });
    await sleep(5000);

    const status = await handle.query('status');
    expect(status).toBe('completed');

    const variables = await handle.query('getVariables');
    expect(variables.apiResponse).toBe('httpResult');
  });

  it('should execute a DSL workflow with a sequence of activities', async () => {
    const sequentialDSL: DSL = {
      variables: {
        apiUrl: 'https://api.example.com/data'
      },
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  with: ['apiUrl'],
                  store: 'rawData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  with: ['rawData'],
                  store: 'formattedData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'processResult',
                  with: ['formattedData'],
                  store: 'finalResult'
                }
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the sequential DSL
    const handle = await execute('DSLWorkflowExample', 'start', { dsl: sequentialDSL });

    // Wait for completion
    await sleep(5000);

    // Check workflow status
    const status = await handle.query('status');
    expect(status).toBe('completed');

    // Verify the variables have been updated with activity results
    const variables = await handle.query('getVariables');
    expect(variables.rawData).toBe('httpResult');
    expect(variables.formattedData).toBe('formattedData');
    expect(variables.finalResult).toBe('processedResult');
  });

  it('should execute a DSL workflow with a workflow step', async () => {
    const stepDSL: DSLDefinition = {
      variables: {
        inputData: 'test_data'
      },
      plan: {
        execute: {
          step: {
            name: 'transformData',
            with: ['inputData'],
            store: 'transformedData'
          }
        }
      }
    };

    const handle = await execute('DSLWorkflowExample', 'start', { dsl: stepDSL });
    await sleep(1000);

    const status = await handle.query('status');
    expect(status).toBe('completed');

    const variables = await handle.query('getVariables');
    expect(variables.transformedData).toBe('transformed_test_data');
  });

  it('should execute a sequence of workflow steps', async () => {
    const sequentialStepsDSL: DSLDefinition = {
      variables: {
        inputData: 'valid_data'
      },
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                step: {
                  name: 'transformData',
                  with: ['inputData'],
                  store: 'transformedData'
                }
              }
            },
            {
              execute: {
                step: {
                  name: 'validateData',
                  with: ['transformedData'],
                  store: 'isValid'
                }
              }
            },
            {
              condition: async (dsl) => dsl.variables['isValid'] === true,
              execute: {
                step: {
                  name: 'formatOutput',
                  with: ['transformedData', 'isValid'],
                  store: 'finalOutput'
                }
              }
            }
          ]
        }
      }
    };

    const handle = await execute('DSLWorkflowExample', 'start', { dsl: sequentialStepsDSL });
    await sleep(2000);

    const status = await handle.query('status');
    expect(status).toBe('completed');

    const variables = await handle.query('getVariables');
    expect(variables.transformedData).toBe('transformed_valid_data');
    expect(variables.isValid).toBe(true);
    expect(variables.finalOutput).toBe('formatted_transformed_valid_data');
  });

  it('should execute a mix of activities and workflow steps', async () => {
    const mixedDSL: DSL = {
      variables: {
        apiUrl: 'https://api.example.com/data'
      },
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  with: ['apiUrl'],
                  store: 'apiData'
                }
              }
            },
            {
              execute: {
                step: {
                  name: 'transformData',
                  with: ['apiData'],
                  store: 'transformedData'
                }
              }
            },
            {
              execute: {
                step: {
                  name: 'validateData',
                  with: ['transformedData'],
                  store: 'isValid'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'processResult',
                  with: ['transformedData', 'isValid'],
                  store: 'finalResult'
                }
              }
            }
          ]
        }
      }
    };

    // Start the workflow with the mixed DSL
    const handle = await execute('DSLWorkflowExample', 'start', { dsl: mixedDSL });

    // Wait for completion
    await sleep(2000);

    // Check workflow status
    const status = await handle.query('status');
    expect(status).toBe('completed');

    // Verify the variables have been updated with both activity and step results
    const variables = await handle.query('getVariables');
    expect(variables.apiData).toBe('httpResult');
    expect(variables.transformedData).toBe('transformed_httpResult');
    expect(variables.isValid).toBe(true);
    expect(variables.finalResult).toBe('processedResult');
  });

  it.skip('should allow updating the DSL during execution', async () => {
    const initialDSL: DSLDefinition = {
      variables: {},
      plan: {
        sequence: { elements: [] }
      }
    };

    const handle = await execute('DSLWorkflowExample', 'start', { dsl: initialDSL });
    await sleep(500);

    // Add a step
    await handle.signal('addStep', {
      name: 'transformData',
      with: ['test_data'],
      store: 'transformedData'
    });

    // Verify the DSL was updated
    const updatedDSL = await handle.query('getDSL');
    expect(updatedDSL.plan.sequence.elements.length).toBe(1);
    expect(updatedDSL.plan.sequence.elements[0].execute.step.name).toBe('transformData');
  });

  it('should execute parallel steps', async () => {
    const parallelDSL: DSLDefinition = {
      variables: {
        data1: 'input1',
        data2: 'input2'
      },
      plan: {
        sequence: {
          elements: [
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      step: {
                        name: 'transformData',
                        with: ['data1'],
                        store: 'transformed1'
                      }
                    }
                  },
                  {
                    execute: {
                      step: {
                        name: 'transformData',
                        with: ['data2'],
                        store: 'transformed2'
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    const handle = await execute('DSLWorkflowExample', 'start', { dsl: parallelDSL });
    await sleep(2000);

    const status = await handle.query('status');
    expect(status).toBe('completed');

    const variables = await handle.query('getVariables');
    expect(variables.transformed1).toBe('transformed_input1');
    expect(variables.transformed2).toBe('transformed_input2');
  });

  it('should execute a long-running workflow step', async () => {
    const longRunningStepDSL: DSLDefinition = {
      variables: {
        sleepTime: 3000 // 3 seconds sleep time
      },
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                step: {
                  name: 'sleepStep',
                  with: ['sleepTime'],
                  store: 'sleepResult'
                }
              }
            }
          ]
        }
      }
    };

    const handle = await execute('DSLWorkflowExample', 'start', { dsl: longRunningStepDSL });
    await sleep(4000);

    const status = await handle.query('status');
    expect(status).toBe('completed');

    const variables = await handle.query('getVariables');
    expect(variables.sleepResult).toBe('slept for 3000ms');
  });
});
