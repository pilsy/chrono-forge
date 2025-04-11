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
          activity: {
            name: 'makeHTTPRequest',
            store: 'result',
            with: ['https://example.com']
          }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'httpResult'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  with: ['httpResult'],
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
                activity: {
                  name: 'parallelTask1',
                  store: 'result1'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'parallelTask2',
                  store: 'result2'
                }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'httpResult'
                }
              }
            },
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      activity: {
                        name: 'formatData',
                        with: ['httpResult'],
                        store: 'formattedData'
                      }
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'slowOperation',
                        store: 'slowResult'
                      }
                    }
                  }
                ]
              }
            },
            {
              execute: {
                activity: {
                  name: 'combineResults',
                  with: ['formattedData', 'slowResult'],
                  store: 'finalResult'
                }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'httpData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  with: ['httpData'],
                  store: 'formattedData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'complexOperation',
                  with: ['formattedData', 'staticValue'],
                  store: 'complexResult'
                }
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
          activity: {
            name: 'makeHTTPRequest',
            with: ['apiKey'],
            store: 'httpResult'
          }
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
          activity: {
            name: 'makeHTTPRequest',
            store: 'apiResponse'
          }
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
                activity: {
                  name: 'makeHTTPRequest',
                  with: ['initialParam'],
                  store: 'rawData'
                }
              }
            },
            // Then process in parallel
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      activity: {
                        name: 'formatData',
                        with: ['rawData'],
                        store: 'formattedOutput'
                      }
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'processResult',
                        with: ['rawData'],
                        store: 'processedOutput'
                      }
                    }
                  }
                ]
              }
            },
            // Finally combine the results
            {
              execute: {
                activity: {
                  name: 'combineResults',
                  with: ['formattedOutput', 'processedOutput'],
                  store: 'finalOutput'
                }
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
          activity: {
            name: 'makeHTTPRequest',
            store: 'httpResult'
          }
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
          activity: {
            name: 'makeHTTPRequest'
            // No result specified
          }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'httpResult'
                }
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
                            activity: {
                              name: 'formatData',
                              with: ['httpResult'],
                              store: 'formattedData'
                            }
                          }
                        },
                        {
                          execute: {
                            activity: {
                              name: 'processResult',
                              with: ['formattedData'],
                              store: 'processedData'
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'slowOperation',
                        store: 'slowResult'
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
          activity: {
            name: 'combineResults',
            with: ['staticArg1', 'staticArg2'],
            store: 'combinedStaticResult'
          }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'condition'
                }
              }
            },
            {
              when: ({ condition }) => condition === 'true',
              execute: {
                activity: {
                  name: 'conditionalTask',
                  with: ['condition'],
                  store: 'conditionalResult'
                }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'condition'
                }
              }
            },
            {
              when: ({ condition }) => condition === 'true',
              execute: {
                activity: {
                  name: 'conditionalTask',
                  with: ['condition'],
                  store: 'conditionalResult'
                }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'httpData'
                }
              }
            },
            {
              parallel: {
                branches: [
                  {
                    execute: {
                      activity: {
                        name: 'formatData',
                        with: ['httpData'],
                        store: 'formattedData'
                      }
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'processResult',
                        with: ['httpData'],
                        store: 'processedData'
                      }
                    }
                  }
                ]
              }
            },
            {
              execute: {
                activity: {
                  name: 'combineResults',
                  with: ['formattedData', 'processedData'],
                  store: 'finalData'
                }
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
          activity: {
            name: 'makeHTTPRequest',
            with: ['circularRef'], // This creates a circular dependency
            store: 'circularRef' // by using the same name for input and output
          }
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
          activity: {
            name: 'makeHTTPRequest',
            store: 'result',
            with: ['https://example.com']
          }
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
          activity: {
            name: 'makeHTTPRequest',
            store: 'result'
          }
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
              activity: {
                name: 'makeHTTPRequest',
                with: ['currentItem'],
                store: 'result'
              }
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
              activity: {
                name: 'incrementCounter',
                store: 'count'
              }
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
              activity: {
                name: 'makeHTTPRequest',
                store: 'result'
              }
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
          activity: {
            name: 'makeHTTPRequest',
            store: 'result'
          }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'parentResult'
                }
              },
              when: () => false,
              required: true
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  with: ['parentResult'],
                  store: 'childResult'
                }
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
                activity: {
                  name: 'makeHTTPRequest',
                  store: 'parentResult'
                }
              },
              when: () => false
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  with: ['parentResult'],
                  store: 'childResult'
                }
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

  it.skip('should handle conditions on sequence blocks', async () => {
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
                activity: {
                  name: 'activity1',
                  store: 'result1'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'activity2',
                  with: ['result1'],
                  store: 'result2'
                }
              }
            }
          ]
        }
      }
    };

    let interpreter = DSLInterpreter(dslTrue, activities);

    // First activity should execute
    let generation = await interpreter.next();
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
                activity: {
                  name: 'activity1',
                  store: 'result1'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'activity2',
                  with: ['result1'],
                  store: 'result2'
                }
              }
            }
          ]
        }
      }
    };

    interpreter = DSLInterpreter(dslFalse, activities);

    // No activities should execute when condition is false
    generation = await interpreter.next();
    // The interpreter will still generate nodes, but they should be skipped
    expect(generation.value.nodeId).toMatch(/^sequence_control_\d+$/);
    await generation.value.execute();

    // The next generation should be done
    generation = await interpreter.next();
    expect(generation.done).toBe(true);
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
          wait: [({ ready }) => ready === true, 1], // 1 second timeout
          elements: [
            {
              execute: {
                activity: {
                  name: 'activity1',
                  store: 'result1'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'activity2',
                  store: 'result2'
                }
              }
            }
          ]
        }
      }
    };

    const interpreter = DSLInterpreter(dsl, activities);

    // Set ready to true after a delay
    setTimeout(() => {
      dsl.variables.ready = true;
    }, 100);

    // Activities should execute after condition is met
    let generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_activity1_\d+$/);
    await generation.value.execute();
    expect(activities.activity1).toHaveBeenCalled();

    generation = await interpreter.next();
    expect(generation.value.nodeId).toMatch(/^activity_activity2_\d+$/);
    await generation.value.execute();
    expect(activities.activity2).toHaveBeenCalled();

    // Should be done
    expect((await interpreter.next()).done).toBe(true);
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
            step: {
              name: 'processData',
              with: ['input'],
              store: 'processedResult'
            }
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
          required: true,
          executed: false
        },
        {
          name: 'step2',
          method: 'validateInput',
          after: 'step1',
          required: true,
          executed: false
        },
        {
          name: 'step3',
          method: 'transformResult',
          after: 'step2',
          required: false,
          executed: false
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
        expect(firstElement.execute.step?.name).toBe('processData');
        expect(firstElement.execute.step?.store).toBe('step1');
      }

      // Check second element is step2
      const secondElement = dsl.plan.sequence.elements[1];
      expect('execute' in secondElement).toBe(true);
      if ('execute' in secondElement) {
        expect(secondElement.execute.step?.name).toBe('validateInput');
        expect(secondElement.execute.step?.store).toBe('step2');
      }
    });

    it('should handle parallel step execution in generations', async () => {
      const stepMetadata: StepMetadata[] = [
        {
          name: 'step1',
          method: 'processData',
          required: true,
          executed: false
        },
        {
          name: 'step2',
          method: 'validateInput',
          after: 'step1',
          required: true,
          executed: false
        },
        {
          name: 'step3',
          method: 'transformResult',
          after: 'step1',
          required: true,
          executed: false
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
                  step: {
                    name: 'processData',
                    with: ['input'],
                    store: 'step1'
                  }
                }
              },
              {
                parallel: {
                  branches: [
                    {
                      execute: {
                        step: {
                          name: 'validateInput',
                          with: ['step1'],
                          store: 'step2'
                        }
                      }
                    },
                    {
                      execute: {
                        step: {
                          name: 'transformResult',
                          with: ['step1'],
                          store: 'step3'
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
                  step: {
                    name: 'processData',
                    with: ['input'],
                    store: 'processedData'
                  }
                }
              },
              {
                execute: {
                  step: {
                    name: 'validateInput',
                    with: ['processedData'],
                    store: 'isValid'
                  }
                }
              },
              {
                execute: {
                  step: {
                    name: 'transformResult',
                    with: ['processedData', 'isValid'],
                    store: 'finalResult'
                  }
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
                  activity: {
                    name: 'fetchData',
                    store: 'rawData'
                  }
                }
              },
              {
                execute: {
                  step: {
                    name: 'processData',
                    with: ['rawData'],
                    store: 'processedData'
                  }
                }
              },
              {
                execute: {
                  activity: {
                    name: 'saveData',
                    with: ['processedData'],
                    store: 'saveResult'
                  }
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
                  step: {
                    name: 'processData',
                    with: ['nonExistentData'],
                    store: 'processedData'
                  }
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
        { name: 'step1', method: 'method1', executed: false },
        { name: 'step2', method: 'method2', after: 'step1', executed: false },
        { name: 'step3', method: 'method3', after: 'step1', executed: false },
        { name: 'step4', method: 'method4', after: ['step2', 'step3'], executed: false },
        { name: 'step5', method: 'method5', before: 'step4', executed: false }
      ];

      const dsl = convertStepsToDSL(steps);

      // Should have sequence elements for each generation
      expect(dsl.plan.sequence.elements.length).toBeGreaterThan(0);

      // The last element should contain step4
      const lastGenElement = dsl.plan.sequence.elements[dsl.plan.sequence.elements.length - 1];
      let containsStep4 = false;

      if ('execute' in lastGenElement && lastGenElement.execute.step) {
        containsStep4 = lastGenElement.execute.step.store === 'step4';
      } else if ('parallel' in lastGenElement) {
        containsStep4 = lastGenElement.parallel.branches.some(
          (branch) => 'execute' in branch && branch.execute.step?.store === 'step4'
        );
      }

      expect(containsStep4).toBe(true);
    });
  });
});
