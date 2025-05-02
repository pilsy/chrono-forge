/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DSLInterpreter, DSLDefinition, convertStepsToDSL } from '../workflows/DSLInterpreter';
import { StepMetadata } from '../decorators/Step';

// Mock the @temporalio/workflow module
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => global.activities)
}));

describe('DSLInterpreter', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should execute a single activity', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          store: 'result',
          with: ['https://example.com']
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    for await (const generation of interpreter) {
      // Check that we only get one node in this generation
      expect(generation.nodeIds).toHaveLength(1);

      // The nodeId should be the auto-generated ID for the activity
      expect(generation.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);

      const result = await generation.execute();
      expect(result).toBe('httpResult');
    }

    // Verify the activity was called
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should execute a sequence of activities in order', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'httpResult'
              }
            },
            {
              execute: {
                activity: 'formatData',
                with: ['httpResult'],
                store: 'formattedData'
              }
            },
            {
              execute: {
                activity: 'processResult',
                with: ['formattedData'],
                store: 'finalResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // First activity node
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    let result = await generation.value.execute();
    expect(result).toBe('httpResult');

    // Second activity node
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    result = await generation.value.execute();
    expect(result).toBe('formattedData');

    // Third activity node
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_processResult_\d+$/);
    result = await generation.value.execute();
    expect(result).toBe('processedResult');

    // Should be done
    generation = await interpreter.next();
    expect(generation.done).toBe(true);

    // Verify the activities were called in order with correct with
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.processResult).toHaveBeenCalledWith('formattedData');
  });

  it('should execute parallel activities', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        parallel: {
          branches: [
            {
              execute: {
                activity: 'parallelTask1',
                store: 'result1'
              }
            },
            {
              execute: {
                activity: 'parallelTask2',
                store: 'result2'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // First parallel task
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_parallelTask1_\d+$/);
    expect(generation.value.nodeIds).toContain(generation.value.nodeId);
    let result = await generation.value.execute();
    expect(result).toBe('parallelResult1');

    // Second parallel task (same generation)
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_parallelTask2_\d+$/);
    expect(generation.value.nodeIds).toContain(generation.value.nodeId);
    result = await generation.value.execute();
    expect(result).toBe('parallelResult2');

    // Both tasks should be in the same generation
    expect(generation.value.nodeIds).toHaveLength(2);

    // Should be done after both tasks
    expect((await interpreter.next()).done).toBe(true);

    // Verify both parallel activities were called
    expect(global.activities.parallelTask1).toHaveBeenCalledTimes(1);
    expect(global.activities.parallelTask2).toHaveBeenCalledTimes(1);
  });

  it('should handle complex nested structures with dependencies', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'httpResult'
              }
            },
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      activity: 'formatData',
                      with: ['httpResult'],
                      store: 'formattedData'
                    }
                  },
                  {
                    execute: {
                      activity: 'slowOperation',
                      store: 'slowResult'
                    }
                  }
                ]
              }
            },
            {
              execute: {
                activity: 'combineResults',
                with: ['formattedData', 'slowResult'],
                store: 'finalResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Generation 1: makeHTTPRequest (no dependencies)
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    let result = await generation.value.execute();
    expect(result).toBe('httpResult');

    // Generation 2: parallel activities (formatData and slowOperation)
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('formattedData');

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_slowOperation_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('slowResult');

    // Generation 3: combineResults
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_combineResults_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('combinedResult');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the execution flow
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.slowOperation).toHaveBeenCalledTimes(1);
    expect(global.activities.combineResults).toHaveBeenCalledWith('formattedData', 'slowResult');
  });

  it('should handle activity dependencies correctly', async () => {
    const dsl: DSLDefinition = {
      variables: {
        staticValue: 'someConstant'
      },
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'httpData'
              }
            },
            {
              execute: {
                activity: 'formatData',
                with: ['httpData'],
                store: 'formattedData'
              }
            },
            {
              execute: {
                activity: 'complexOperation',
                with: ['formattedData', 'staticValue'],
                store: 'complexResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // First generation
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    let result = await generation.value.execute();
    expect(result).toBe('httpResult');

    // Second generation
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('formattedData');

    // Third generation
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_complexOperation_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('complexResult');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the activities were called with correct with
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.complexOperation).toHaveBeenCalledWith('formattedData', 'someConstant');
  });

  it('should handle predefined variables in the DSL', async () => {
    const dsl: DSLDefinition = {
      variables: {
        predefinedValue: 'initialValue',
        apiKey: 'secret-key'
      },
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          with: ['apiKey'],
          store: 'httpResult'
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Single generation
    const generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    const result = await generation.value.execute();
    expect(result).toBe('httpResult');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the activity was called with the predefined variable
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledWith('secret-key');
  });

  it('should update bindings with activity results', async () => {
    // Mock implementation that returns a specific value
    global.activities.makeHTTPRequest.mockResolvedValue('responseData');

    // Create a DSL that stores the result
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          store: 'apiResponse'
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Get the single generation
    const generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);

    // Execute the activity
    const result = await generation.value.execute();
    expect(result).toBe('responseData');

    // Verify the variables were updated
    expect((dsl.variables as Record<string, string>)['apiResponse']).toBe('responseData');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);
  });

  it('should handle a complex workflow with multiple dependencies', async () => {
    // Set up mocked responses
    global.activities.makeHTTPRequest.mockResolvedValue('api_data');
    global.activities.formatData.mockImplementation((data: string) => Promise.resolve(`formatted_${data}`));
    global.activities.processResult.mockImplementation((data: string) => Promise.resolve(`processed_${data}`));
    global.activities.combineResults.mockImplementation((a: string, b: string) =>
      Promise.resolve(`combined_${a}_${b}`)
    );

    const dsl: DSLDefinition = {
      variables: {
        initialParam: 'startValue'
      },
      plan: {
        sequence: {
          elements: [
            // First get API data
            {
              execute: {
                activity: 'makeHTTPRequest',
                with: ['initialParam'],
                store: 'rawData'
              }
            },
            // Then process in parallel
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      activity: 'formatData',
                      with: ['rawData'],
                      store: 'formattedOutput'
                    }
                  },
                  {
                    execute: {
                      activity: 'processResult',
                      with: ['rawData'],
                      store: 'processedOutput'
                    }
                  }
                ]
              }
            },
            // Finally combine the results
            {
              execute: {
                activity: 'combineResults',
                with: ['formattedOutput', 'processedOutput'],
                store: 'finalOutput'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Generation 1: makeHTTPRequest
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    let result = await generation.value.execute();
    expect(result).toBe('api_data');

    // Generation 2: parallel formatData and processResult
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('formatted_api_data');

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_processResult_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('processed_api_data');

    // Generation 3: combineResults
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_combineResults_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('combined_formatted_api_data_processed_api_data');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the execution flow
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledWith('startValue');
    expect(global.activities.formatData).toHaveBeenCalledWith('api_data');
    expect(global.activities.processResult).toHaveBeenCalledWith('api_data');
    expect(global.activities.combineResults).toHaveBeenCalledWith('formatted_api_data', 'processed_api_data');

    // Verify the final result
    expect((dsl.variables as Record<string, string>)['finalOutput']).toBe(
      'combined_formatted_api_data_processed_api_data'
    );
  });

  it('should handle empty variables object', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          store: 'httpResult'
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Get the single generation
    const generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);

    // Execute the activity
    await generation.value.execute();

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the activity was called
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should handle activities without result binding', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('noBindingResult');

    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        execute: {
          activity: 'makeHTTPRequest'
          // No result specified
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Get the single generation
    const generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);

    // Execute the activity and verify it doesn't crash
    await generation.value.execute();

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the activity was called
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should handle deeply nested sequences and parallels', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('httpResult');

    // Temporarily mock formatData to match the test expectations
    const originalFormatData = global.activities.formatData;
    global.activities.formatData.mockImplementation((input) => Promise.resolve('formattedData'));

    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'httpResult'
              }
            },
            {
              parallel: {
                branches: [
                  {
                    sequence: {
                      elements: [
                        {
                          execute: {
                            activity: 'formatData',
                            with: ['httpResult'],
                            store: 'formattedData'
                          }
                        },
                        {
                          execute: {
                            activity: 'processResult',
                            with: ['formattedData'],
                            store: 'processedData'
                          }
                        }
                      ]
                    }
                  },
                  {
                    execute: {
                      activity: 'slowOperation',
                      store: 'slowResult'
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Generation 1: makeHTTPRequest
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    let result = await generation.value.execute();
    expect(result).toBe('httpResult');

    // Generation 2: parallel formatData and slowOperation
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('formattedData');

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_slowOperation_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('slowResult');

    // Generation 3: processResult (depends on formatData)
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_processResult_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('processed_formattedData');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the execution flow
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.processResult).toHaveBeenCalledWith('formattedData');
    expect(global.activities.slowOperation).toHaveBeenCalledTimes(1);

    // Restore original mock
    global.activities.formatData = originalFormatData;
  });

  it('should handle activity with that are static values', async () => {
    global.activities.combineResults.mockResolvedValue('combinedResult');
    const dsl: DSLDefinition = {
      variables: {
        staticArg1: 'value1',
        staticArg2: 'value2'
      },
      plan: {
        execute: {
          activity: 'combineResults',
          with: ['staticArg1', 'staticArg2'],
          store: 'combinedStaticResult'
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Get the single generation
    const generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_combineResults_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);

    // Execute the activity
    const result = await generation.value.execute();
    expect(result).toBe('combinedResult');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the activity was called with the static values
    expect(global.activities.combineResults).toHaveBeenCalledWith('value1', 'value2');

    // Verify the result was stored in variables
    expect((dsl.variables as Record<string, string>)['combinedStaticResult']).toBe('combinedResult');
  });

  it('should support conditional execution when condition is met', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('true');
    global.activities.conditionalTask.mockResolvedValue('condition met');

    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'condition'
              }
            },
            {
              when: ({ condition }) => condition === 'true',
              execute: {
                activity: 'conditionalTask',
                with: ['condition'],
                store: 'conditionalResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // First activity: makeHTTPRequest
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    let result = await generation.value.execute();
    expect(result).toBe('true');

    // Second activity: conditionalTask (should execute because condition is true)
    generation = await interpreter.next();
    expect(generation.done).toBe(false);
    expect(generation.value.nodeId).toMatch(/^activity_conditionalTask_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('condition met');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the execution flow
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.conditionalTask).toHaveBeenCalledWith('true');
    expect((dsl.variables as Record<string, string>)['conditionalResult']).toBe('condition met');
  });

  it('should skip execution when condition is not met', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('false');
    global.activities.conditionalTask.mockResolvedValue('condition not met');

    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'condition'
              }
            },
            {
              when: ({ condition }) => condition === 'true',
              execute: {
                activity: 'conditionalTask',
                with: ['condition'],
                store: 'conditionalResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // First activity: makeHTTPRequest
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    await generation.value.execute();

    // Second activity should be skipped due to condition not being met
    // The interpreter should not yield a generation for the conditional task
    generation = await interpreter.next();
    expect(generation.done).toBe(true);

    // Verify the execution flow
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.conditionalTask).not.toHaveBeenCalled();
    expect(dsl.variables['conditionalResult']).toBeUndefined();
  });

  it('should handle activities with multiple outputs that feed into future activities', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('request_data');
    global.activities.formatData.mockResolvedValue('formatted_request_data');
    global.activities.processResult.mockResolvedValue('processed_request_data');
    global.activities.combineResults.mockImplementation((a, b) => Promise.resolve(`combined_${a}_${b}`));

    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'httpData'
              }
            },
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      activity: 'formatData',
                      with: ['httpData'],
                      store: 'formattedData'
                    }
                  },
                  {
                    execute: {
                      activity: 'processResult',
                      with: ['httpData'],
                      store: 'processedData'
                    }
                  }
                ]
              }
            },
            {
              execute: {
                activity: 'combineResults',
                with: ['formattedData', 'processedData'],
                store: 'finalData'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // First generation: makeHTTPRequest
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_makeHTTPRequest_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    let result = await generation.value.execute();
    expect(result).toBe('request_data');

    // Second generation: parallel formatData and processResult
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('formatted_request_data');

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_processResult_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(2);
    result = await generation.value.execute();
    expect(result).toBe('processed_request_data');

    // Third generation: combineResults
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_combineResults_\d+$/);
    expect(generation.value.nodeIds).toHaveLength(1);
    result = await generation.value.execute();
    expect(result).toBe('combined_formatted_request_data_processed_request_data');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Verify the execution flow
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('request_data');
    expect(global.activities.processResult).toHaveBeenCalledWith('request_data');
    expect(global.activities.combineResults).toHaveBeenCalledWith('formatted_request_data', 'processed_request_data');
  });

  it('should throw an error if there is a circular dependency', async () => {
    // Create a DSL that directly references itself
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          with: ['circularRef'], // This creates a circular dependency
          store: 'circularRef' // by using the same name for input and output
        }
      }
    };

    // Use a try-catch pattern to verify the error is thrown
    let error;
    try {
      const interpreter = DSLInterpreter(dsl, global.activities);
      await interpreter.next(); // Force execution to trigger the error
    } catch (e) {
      error = e;
    }

    // Assert that we got an error with the expected message
    expect(error).toBeDefined();
    expect(error.message).toContain('Circular dependency detected');
  });

  it('should handle wait conditions with timeout', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('httpResult');

    const dsl: DSLDefinition = {
      variables: { ready: false },
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          store: 'result',
          with: ['https://example.com']
        },
        wait: [({ ready }) => ready === true, 5] // 5 second timeout
      }
    };

    // Simulate condition becoming true after delay
    setTimeout(() => {
      dsl.variables.ready = true;
    }, 1000);

    const interpreter = DSLInterpreter(dsl, global.activities);
    const generation = await interpreter.next();

    const result = await generation.value.execute();
    expect(result).toBe('httpResult');
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should skip node when wait condition times out', async () => {
    const dsl: DSLDefinition = {
      variables: { ready: false },
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          store: 'result'
        },
        wait: [({ ready }) => ready === true, 1] // 1 second timeout - moved to correct level
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);
    const generation = await interpreter.next();

    console.log(generation);

    // The node should be skipped due to timeout
    // The interpreter should not yield a generation for this node
    expect(generation.done).toBe(true);
    expect(global.activities.makeHTTPRequest).not.toHaveBeenCalled();
    expect(dsl.variables.result).toBeUndefined();
  });

  it('should execute foreach loop with array access', async () => {
    const dsl: DSLDefinition = {
      variables: {
        items: [{ url: 'http://example1.com' }, { url: 'http://example2.com' }]
      },
      plan: {
        foreach: {
          in: 'items',
          as: 'currentItem',
          body: {
            execute: {
              activity: 'makeHTTPRequest',
              with: ['currentItem'],
              store: 'result'
            }
          }
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);
    const generation = await interpreter.next();
    await generation.value.execute();

    expect(global.activities.makeHTTPRequest).toHaveBeenCalledWith({ url: 'http://example1.com' });
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledWith({ url: 'http://example2.com' });
  });

  it('should execute while loop until condition is met', async () => {
    let counter = 0;
    const dsl: DSLDefinition = {
      variables: { count: 0 },
      plan: {
        while: {
          condition: async (variables) => variables.count < 3,
          body: {
            execute: {
              activity: 'incrementCounter',
              store: 'count'
            }
          }
        }
      }
    };

    // Mock incrementCounter to increase the count
    global.activities.incrementCounter = jest.fn().mockImplementation(() => {
      counter++;
      dsl.variables.count = counter;
      return counter;
    });

    const interpreter = DSLInterpreter(dsl, global.activities);
    const generation = await interpreter.next();
    await generation.value.execute();

    expect(global.activities.incrementCounter).toHaveBeenCalledTimes(3);
    expect(dsl.variables.count).toBe(3);
  });

  it('should execute do-while loop at least once', async () => {
    const dsl: DSLDefinition = {
      variables: { count: 10 }, // Start with condition already false
      plan: {
        doWhile: {
          body: {
            execute: {
              activity: 'makeHTTPRequest',
              store: 'result'
            }
          },
          condition: async (variables) => variables.count < 1
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);
    const generation = await interpreter.next();
    await generation.value.execute();

    // Should be called exactly once despite condition being false initially
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should handle error in condition evaluation', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        execute: {
          activity: 'makeHTTPRequest',
          store: 'result'
        },
        when: () => {
          throw new Error('Condition evaluation failed');
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);
    const generation = await interpreter.next();
    expect(generation.done).toBe(true);

    // Activity should be skipped due to condition error
    expect(global.activities.makeHTTPRequest).not.toHaveBeenCalled();
  });

  it('should skip dependent nodes when parent is skipped but required', async () => {
    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'parentResult'
              },
              when: () => false,
              required: true
            },
            {
              execute: {
                activity: 'formatData',
                with: ['parentResult'],
                store: 'childResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Parent task generation
    let generation = await interpreter.next();

    expect(generation.done).toBe(true);
    expect(global.activities.makeHTTPRequest).not.toHaveBeenCalled();
    expect(global.activities.formatData).not.toHaveBeenCalled();
  });

  it('should not skip dependent nodes when parent is skipped but not required', async () => {
    global.activities.formatData.mockResolvedValue('formattedData');

    const dsl: DSLDefinition = {
      variables: {},
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: 'makeHTTPRequest',
                store: 'parentResult'
              },
              when: () => false
            },
            {
              execute: {
                activity: 'formatData',
                with: ['parentResult'],
                store: 'childResult'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, global.activities);

    // Parent task generation
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_formatData_\d+$/);
    let result = await generation.value.execute();
    expect(result).toBe('formattedData');

    generation = await interpreter.next();

    expect(generation.done).toBe(true);
    expect(global.activities.makeHTTPRequest).not.toHaveBeenCalled();
    expect(global.activities.formatData).toHaveBeenCalled();
  });

  it('should handle conditions on sequence blocks', async () => {
    // Mock activities
    const activities = {
      activity1: jest.fn().mockResolvedValue('result1'),
      activity2: jest.fn().mockResolvedValue('result2')
    };

    // Test case 1: Condition is true
    const dslTrue: DSLDefinition = {
      variables: { flag: true },
      plan: {
        sequence: {
          when: ({ flag }) => flag === true,
          elements: [
            {
              execute: {
                activity: 'activity1',
                store: 'result1'
              }
            },
            {
              execute: {
                activity: 'activity2',
                with: ['result1'],
                store: 'result2'
              }
            }
          ]
        }
      }
    };

    let interpreter = DSLInterpreter(dslTrue, activities);

    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^sequence_condition_\d+$/);
    await generation.value.execute();

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_activity1_\d+$/);
    await generation.value.execute();
    expect(activities.activity1).toHaveBeenCalled();

    // Second activity should execute
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_activity2_\d+$/);
    await generation.value.execute();
    expect(activities.activity2).toHaveBeenCalledWith('result1');

    // Should be done
    expect((await interpreter.next()).done).toBe(true);

    // Reset mocks
    activities.activity1.mockClear();
    activities.activity2.mockClear();

    // Test case 2: Condition is false
    const dslFalse: DSLDefinition = {
      variables: { flag: false },
      plan: {
        sequence: {
          when: ({ flag }) => flag === true,
          elements: [
            {
              execute: {
                activity: 'activity1',
                store: 'result1'
              }
            },
            {
              execute: {
                activity: 'activity2',
                with: ['result1'],
                store: 'result2'
              }
            }
          ]
        }
      }
    };

    interpreter = DSLInterpreter(dslFalse, activities);

    // When the sequence condition is false, we shouldn't get any nodes
    // since the sequence node and all descendants should be skipped
    generation = await interpreter.next();

    // The interpreter should be done
    expect(generation.done).toBe(true);

    // No activities should have been called
    expect(activities.activity1).not.toHaveBeenCalled();
    expect(activities.activity2).not.toHaveBeenCalled();
  });

  it('should handle wait on sequence blocks', async () => {
    const activities = {
      activity1: jest.fn().mockResolvedValue('result1'),
      activity2: jest.fn().mockResolvedValue('result2')
    };

    const dsl: DSLDefinition = {
      variables: { ready: false },
      plan: {
        sequence: {
          wait: ({ ready }) => ready,
          elements: [
            {
              execute: {
                activity: 'activity1',
                store: 'result1'
              }
            },
            {
              execute: {
                activity: 'activity2',
                store: 'result2'
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, activities);

    setTimeout(() => (dsl.variables.ready = true), 1000);

    let generation = await interpreter.next();
    await generation.value.execute();

    // Activities should execute after condition is met
    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_activity\d_\d+$/);
    await generation.value.execute();
    expect(activities.activity1).toHaveBeenCalled();

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_activity\d_\d+$/);
    await generation.value.execute();
    expect(activities.activity2).toHaveBeenCalled();

    // Should be done
    expect((await interpreter.next()).done).toBe(true);
  });

  describe('Code Execution', () => {
    it('should execute direct code and store the result', async () => {
      const dsl: DSLDefinition = {
        variables: { x: 5, y: 3 },
        plan: {
          execute: {
            code: 'const result = x + y; return result;',
            with: ['x', 'y'],
            store: 'sum'
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // Get the single generation
      const generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^code_\d_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      const result = await generation.value.execute();

      // Check the result
      expect(result).toBe(8);
      expect(dsl.variables.sum).toBe(8);

      // Should be done
      expect((await interpreter.next()).done).toBe(true);
    });

    it('should execute code that modifies workflow variables', async () => {
      const dsl: DSLDefinition = {
        variables: { counter: 0, items: ['a', 'b', 'c'] },
        plan: {
          execute: {
            code: `
                counter += 1;
                items.push('d');
                return items.length;
              `,
            with: ['counter', 'items'],
            store: 'itemCount'
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // Get the single generation
      const generation = await interpreter.next();
      const result = await generation.value.execute();

      // Check the results
      expect(result).toBe(4);
      expect(dsl.variables.counter).toBe(1);
      expect(dsl.variables.items).toEqual(['a', 'b', 'c', 'd']);
      expect(dsl.variables.itemCount).toBe(4);
    });

    it('should execute code in sequence with other steps', async () => {
      // Set up mock activities
      global.activities = {
        getData: jest.fn().mockResolvedValue({ value: 10 })
      };

      const dsl: DSLDefinition = {
        variables: { multiplier: 2 },
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  activity: 'getData',
                  store: 'data'
                }
              },
              {
                execute: {
                  code: `
                      const calculated = data.value * multiplier;
                      return calculated;
                    `,
                  with: ['data', 'multiplier'],
                  store: 'result'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, global.activities);

      // First generation - getData activity
      let generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^activity_getData_\d+$/);
      let result = await generation.value.execute();
      expect(result).toEqual({ value: 10 });

      // Second generation - code execution
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^code_\d_\d+$/);
      result = await generation.value.execute();
      expect(result).toBe(20);
      expect(dsl.variables.result).toBe(20);

      // Should be done
      expect((await interpreter.next()).done).toBe(true);
    });

    it('should execute code with parameters from "with" array', async () => {
      const dsl: DSLDefinition = {
        variables: {
          firstName: 'John',
          lastName: 'Doe',
          age: 30
        },
        plan: {
          execute: {
            code: `
              const fullName = firstName + ' ' + lastName;
              const isAdult = age >= 18;
              return { fullName, isAdult };
            `,
            with: ['firstName', 'lastName', 'age'],
            store: 'person'
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // Get the single generation
      const generation = await interpreter.next();
      const result = await generation.value.execute();

      // Check the results
      expect(result).toEqual({ fullName: 'John Doe', isAdult: true });
      expect(dsl.variables.person).toEqual({ fullName: 'John Doe', isAdult: true });
    });

    it('should execute code in parallel with other operations', async () => {
      const dsl: DSLDefinition = {
        variables: { base: 5 },
        plan: {
          parallel: {
            branches: [
              {
                execute: {
                  code: 'return base * 2;',
                  with: ['base'],
                  store: 'doubled'
                }
              },
              {
                execute: {
                  code: 'return base * base;',
                  with: ['base'],
                  store: 'squared'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // First parallel branch
      let generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^code_\d_\d+$/);
      let result = await generation.value.execute();
      expect(result).toBe(10);
      expect(dsl.variables.doubled).toBe(10);

      // Second parallel branch
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^code_\d_\d+$/);
      result = await generation.value.execute();
      expect(result).toBe(25);
      expect(dsl.variables.squared).toBe(25);

      // Should be done
      expect((await interpreter.next()).done).toBe(true);
    });

    it('should handle complex code with conditionals and loops', async () => {
      const dsl: DSLDefinition = {
        variables: { numbers: [1, 2, 3, 4, 5] },
        plan: {
          execute: {
            code: `
                let sum = 0;
                let evenCount = 0;
                
                for (const num of numbers) {
                  sum += num;
                  if (num % 2 === 0) {
                    evenCount++;
                  }
                }
                
                return { sum, evenCount };
              `,
            with: ['numbers'],
            store: 'stats'
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // Get the single generation
      const generation = await interpreter.next();
      const result = await generation.value.execute();

      // Check the results
      expect(result).toEqual({ sum: 15, evenCount: 2 });
      expect(dsl.variables.stats).toEqual({ sum: 15, evenCount: 2 });
    });

    it('should execute code inside a foreach loop', async () => {
      const dsl: DSLDefinition = {
        variables: {
          items: [1, 2, 3],
          results: []
        },
        plan: {
          foreach: {
            in: 'items',
            as: 'currentItem',
            body: {
              execute: {
                code: `
                  const squared = currentItem * currentItem;
                  results.push(squared);
                  return squared;
                `,
                with: ['items', 'currentItem', 'results'],
                store: 'lastResult'
              }
            }
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // Execute the loop
      const generation = await interpreter.next();
      await generation.value.execute();

      // Check results
      expect(dsl.variables.results).toEqual([1, 4, 9]);
      expect(dsl.variables.lastResult).toBe(9); // Last iteration result
    });

    it('should execute code inside a while loop', async () => {
      const dsl: DSLDefinition = {
        variables: {
          counter: 0,
          sum: 0
        },
        plan: {
          while: {
            condition: (variables) => variables.counter < 5,
            body: {
              execute: {
                code: `
                  counter += 1;
                  sum += counter;
                  return counter;
                `,
                with: ['counter', 'sum'],
                store: 'currentValue'
              }
            }
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // Execute the loop
      const generation = await interpreter.next();
      await generation.value.execute();

      // Check results - should have summed 1+2+3+4+5 = 15
      expect(dsl.variables.counter).toBe(5);
      expect(dsl.variables.sum).toBe(15);
    });

    it('should handle errors in code execution gracefully', async () => {
      const dsl: DSLDefinition = {
        variables: {},
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  code: 'throw new Error("Test error");',
                  store: 'result'
                }
              },
              {
                execute: {
                  code: 'return "This should not execute";',
                  store: 'secondResult'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {});

      // First code block with error
      const generation = await interpreter.next();

      // Should throw an error when executed
      await expect(generation.value.execute()).rejects.toThrow();

      // Variables should remain unchanged
      expect(dsl.variables.result).toBeUndefined();
      expect(dsl.variables.secondResult).toBeUndefined();
    });

    it('should allow code to reference results from previous steps', async () => {
      // Set up mock activities
      global.activities = {
        getData: jest.fn().mockResolvedValue([10, 20, 30])
      };

      const dsl: DSLDefinition = {
        variables: {},
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  activity: 'getData',
                  store: 'data'
                }
              },
              {
                execute: {
                  code: `
                    return data.reduce((sum, val) => sum + val, 0);
                  `,
                  with: ['data'],
                  store: 'sum'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, global.activities);

      // First generation - getData activity
      let generation = await interpreter.next();
      await generation.value.execute();

      // Second generation - code execution
      generation = await interpreter.next();
      const result = await generation.value.execute();

      // Should calculate sum of the array: 10+20+30 = 60
      expect(result).toBe(60);
      expect(dsl.variables.sum).toBe(60);
    });
  });

  describe('Step Integration', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();

      // Setup workflow step functions for testing
      global.workflowSteps = {
        processData: jest.fn(async (data) => `processed_${data}`),
        validateInput: jest.fn(async (input) => (input === 'valid' ? true : false)),
        transformResult: jest.fn(async (input) => `transformed_${input}`)
      };
    });

    it('should execute a DSL with step invocation', async () => {
      const dsl: DSLDefinition = {
        variables: { input: 'test_data' },
        plan: {
          execute: {
            step: 'processData',
            with: ['input'],
            store: 'processedResult'
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {}, global.workflowSteps);

      // Single generation
      const generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_processData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      const result = await generation.value.execute();
      expect(result).toBe('processed_test_data');

      // Should be done
      expect((await interpreter.next()).done).toBe(true);

      expect(global.workflowSteps.processData).toHaveBeenCalledWith('test_data');
      expect((dsl.variables as Record<string, string>)['processedResult']).toBe('processed_test_data');
    });

    it('should convert StepMetadata to DSL format', () => {
      const stepMetadata: StepMetadata[] = [
        {
          name: 'step1',
          method: 'processData',
          required: true
        },
        {
          name: 'step2',
          method: 'validateInput',
          after: 'step1',
          required: true
        },
        {
          name: 'step3',
          method: 'transformResult',
          after: 'step2',
          required: false
        }
      ];

      const dsl = convertStepsToDSL(stepMetadata, { initialValue: 'test' });

      // The DSL should have the correct structure
      expect(dsl.variables).toEqual({ initialValue: 'test' });
      expect(dsl.plan.sequence).toBeDefined();

      // Should have 3 elements in correct execution order
      expect(dsl.plan.sequence.elements.length).toBe(3);

      // Check first element is step1
      const firstElement = dsl.plan.sequence.elements[0];
      expect('execute' in firstElement).toBe(true);
      if ('execute' in firstElement) {
        expect(firstElement.execute.step).toBe('processData');
        expect(firstElement.execute.store).toBe('step1');
      }

      // Check second element is step2
      const secondElement = dsl.plan.sequence.elements[1];
      expect('execute' in secondElement).toBe(true);
      if ('execute' in secondElement) {
        expect(secondElement.execute.step).toBe('validateInput');
        expect(secondElement.execute.store).toBe('step2');
      }
    });

    it('should handle parallel step execution in generations', async () => {
      const stepMetadata: StepMetadata[] = [
        {
          name: 'step1',
          method: 'processData',
          required: true
        },
        {
          name: 'step2',
          method: 'validateInput',
          after: 'step1',
          required: true
        },
        {
          name: 'step3',
          method: 'transformResult',
          after: 'step1',
          required: true
        }
      ];

      // Create a DSL with explicit with for the first step
      const dsl = {
        variables: { input: 'test_data' },
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  step: 'processData',
                  with: ['input'],
                  store: 'step1'
                }
              },
              {
                parallel: {
                  branches: [
                    {
                      execute: {
                        step: 'validateInput',
                        with: ['step1'],
                        store: 'step2'
                      }
                    },
                    {
                      execute: {
                        step: 'transformResult',
                        with: ['step1'],
                        store: 'step3'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {}, global.workflowSteps);

      // First generation - step1
      let generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_processData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      let result = await generation.value.execute();
      expect(result).toBe('processed_test_data');

      // Second generation - parallel step2 and step3
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_validateInput_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(2);
      result = await generation.value.execute();
      expect(result).toBe(false);

      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_transformResult_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(2);
      result = await generation.value.execute();
      expect(result).toBe('transformed_processed_test_data');

      // Should be done
      expect((await interpreter.next()).done).toBe(true);

      // Verify all functions were called
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('test_data');
      expect(global.workflowSteps.validateInput).toHaveBeenCalledWith('processed_test_data');
      expect(global.workflowSteps.transformResult).toHaveBeenCalledWith('processed_test_data');
    });

    it('should pass step results as parameters to subsequent steps', async () => {
      global.workflowSteps.processData.mockResolvedValue('processed_data');
      global.workflowSteps.validateInput.mockResolvedValue(true);
      global.workflowSteps.transformResult.mockImplementation((data, isValid) =>
        Promise.resolve(`transformed_${data}_${isValid}`)
      );

      const dsl: DSLDefinition = {
        variables: { input: 'original_data' },
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  step: 'processData',
                  with: ['input'],
                  store: 'processedData'
                }
              },
              {
                execute: {
                  step: 'validateInput',
                  with: ['processedData'],
                  store: 'isValid'
                }
              },
              {
                execute: {
                  step: 'transformResult',
                  with: ['processedData', 'isValid'],
                  store: 'finalResult'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {}, global.workflowSteps);

      // First step: processData
      let generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_processData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      let result = await generation.value.execute();
      expect(result).toBe('processed_data');

      // Second step: validateInput
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_validateInput_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      result = await generation.value.execute();
      expect(result).toBe(true);

      // Third step: transformResult
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_transformResult_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      result = await generation.value.execute();
      expect(result).toBe('transformed_processed_data_true');

      // Should be done
      expect((await interpreter.next()).done).toBe(true);

      // Verify the data flow between steps
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('original_data');
      expect(global.workflowSteps.validateInput).toHaveBeenCalledWith('processed_data');
      expect(global.workflowSteps.transformResult).toHaveBeenCalledWith('processed_data', true);
    });

    it('should handle mix of activities and steps', async () => {
      global.activities = {
        fetchData: jest.fn(async () => 'fetched_data'),
        saveData: jest.fn(async (data) => `saved_${data}`)
      };

      const dsl: DSLDefinition = {
        variables: {},
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  activity: 'fetchData',
                  store: 'rawData'
                }
              },
              {
                execute: {
                  step: 'processData',
                  with: ['rawData'],
                  store: 'processedData'
                }
              },
              {
                execute: {
                  activity: 'saveData',
                  with: ['processedData'],
                  store: 'saveResult'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, global.activities, global.workflowSteps);

      // First generation: fetchData activity
      let generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^activity_fetchData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      let result = await generation.value.execute();
      expect(result).toBe('fetched_data');

      // Second generation: processData step
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_processData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      result = await generation.value.execute();
      expect(result).toBe('processed_fetched_data');

      // Third generation: saveData activity
      generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^activity_saveData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      result = await generation.value.execute();
      expect(result).toBe('saved_processed_fetched_data');

      // Should be done
      expect((await interpreter.next()).done).toBe(true);

      // Verify activity and step interactions
      expect(global.activities.fetchData).toHaveBeenCalled();
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('fetched_data');
      expect(global.activities.saveData).toHaveBeenCalledWith('processed_fetched_data');
    });

    it('should throw error if step depends on missing result', async () => {
      const dsl: DSLDefinition = {
        variables: {},
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  step: 'processData',
                  with: ['nonExistentData'],
                  store: 'processedData'
                }
              }
            ]
          }
        }
      };

      const interpreter = DSLInterpreter(dsl, {}, global.workflowSteps);

      // Get the single generation
      const generation = await interpreter.next();
      expect(generation.value.nodeId).toMatch(/^step_processData_\d+$/);
      expect(generation.value.nodeIds).toHaveLength(1);
      await generation.value.execute();

      // Should be done
      expect((await interpreter.next()).done).toBe(true);

      // Verify the step was called with undefined argument
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('nonExistentData');
    });
  });

  describe('convertStepsToDSL Function', () => {
    it('should handle empty steps array', () => {
      const dsl = convertStepsToDSL([], { testVar: 'value' });

      expect(dsl.variables).toEqual({ testVar: 'value' });
      expect(dsl.plan.sequence.elements).toEqual([]);
    });

    it('should handle circular dependencies', () => {
      const steps: StepMetadata[] = [
        {
          name: 'step1',
          method: 'method1',
          after: 'step2',
          executed: false
        },
        {
          name: 'step2',
          method: 'method2',
          after: 'step1',
          executed: false
        }
      ];

      expect(() => convertStepsToDSL(steps)).toThrow('Circular dependency detected');
    });

    it('should handle complex dependency patterns', () => {
      const steps: StepMetadata[] = [
        { name: 'step1', method: 'method1' },
        { name: 'step2', method: 'method2', after: 'step1' },
        { name: 'step3', method: 'method3', after: 'step1' },
        { name: 'step4', method: 'method4', after: ['step2', 'step3'] },
        { name: 'step5', method: 'method5', before: 'step4' }
      ];

      const dsl = convertStepsToDSL(steps);

      // Should have sequence elements for each generation
      expect(dsl.plan.sequence.elements.length).toBeGreaterThan(0);

      // The last element should contain step4
      const lastGenElement = dsl.plan.sequence.elements[dsl.plan.sequence.elements.length - 1];
      let containsStep4 = false;

      if ('execute' in lastGenElement && lastGenElement.execute.step) {
        containsStep4 = lastGenElement.execute.store === 'step4';
      } else if ('parallel' in lastGenElement) {
        containsStep4 = lastGenElement.parallel.branches.some(
          (branch) => 'execute' in branch && branch.execute.store === 'step4'
        );
      }

      expect(containsStep4).toBe(true);
    });
  });
});
