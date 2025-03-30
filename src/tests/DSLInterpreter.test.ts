/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DSLInterpreter, DSL } from '../workflows/DSLInterpreter';

// Mock the @temporalio/workflow module
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => global.activities)
}));

describe('DSLInterpreter', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should execute a simple activity', async () => {
    // Create a simple DSL with a single activity
    const dsl: DSL = {
      variables: {},
      root: {
        activity: {
          name: 'makeHTTPRequest',
          result: 'httpResult'
        }
      }
    };

    // Use the global.activities directly as injected activities
    await DSLInterpreter(dsl, global.activities);

    // Verify the activity was called
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should execute a sequence of activities in order', async () => {
    // Create a DSL with a sequence of activities
    const dsl: DSL = {
      variables: {},
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                result: 'httpResult'
              }
            },
            {
              activity: {
                name: 'formatData',
                arguments: ['httpResult'],
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

    await DSLInterpreter(dsl, global.activities);

    // Verify the activities were called in order
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.processResult).toHaveBeenCalledTimes(1);
    expect(global.activities.processResult).toHaveBeenCalledWith('formattedData');
  });

  it('should execute parallel activities', async () => {
    // Create a DSL with parallel activities
    const dsl: DSL = {
      variables: {},
      root: {
        parallel: {
          branches: [
            {
              activity: {
                name: 'parallelTask1',
                result: 'result1'
              }
            },
            {
              activity: {
                name: 'parallelTask2',
                result: 'result2'
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    // Verify both parallel activities were called
    expect(global.activities.parallelTask1).toHaveBeenCalledTimes(1);
    expect(global.activities.parallelTask2).toHaveBeenCalledTimes(1);
  });

  it('should handle complex nested structures with dependencies', async () => {
    // Create a complex DSL with nested sequences and parallel branches
    const dsl: DSL = {
      variables: {},
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                result: 'httpResult'
              }
            },
            {
              parallel: {
                branches: [
                  {
                    activity: {
                      name: 'formatData',
                      arguments: ['httpResult'],
                      result: 'formattedData'
                    }
                  },
                  {
                    activity: {
                      name: 'slowOperation',
                      result: 'slowResult'
                    }
                  }
                ]
              }
            },
            {
              activity: {
                name: 'combineResults',
                arguments: ['formattedData', 'slowResult'],
                result: 'finalResult'
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    // Verify the sequence of calls
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);

    // Both formatData and slowOperation should be called
    expect(global.activities.formatData).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.slowOperation).toHaveBeenCalledTimes(1);

    // combineResults should be called with both results
    expect(global.activities.combineResults).toHaveBeenCalledTimes(1);
    expect(global.activities.combineResults).toHaveBeenCalledWith('formattedData', 'slowResult');
  });

  it('should handle activity dependencies correctly', async () => {
    // Create a DSL with explicit dependencies
    const dsl: DSL = {
      variables: {
        staticValue: 'someConstant'
      },
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                result: 'httpData'
              }
            },
            {
              activity: {
                name: 'formatData',
                arguments: ['httpData'],
                result: 'formattedData'
              }
            },
            {
              activity: {
                name: 'complexOperation',
                arguments: ['formattedData', 'staticValue'],
                result: 'complexResult'
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    // Verify the activities were called with correct arguments
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.complexOperation).toHaveBeenCalledWith('formattedData', 'someConstant');
  });

  it('should handle predefined variables in the DSL', async () => {
    // Create a DSL with predefined variables
    const dsl: DSL = {
      variables: {
        predefinedValue: 'initialValue',
        apiKey: 'secret-key'
      },
      root: {
        activity: {
          name: 'makeHTTPRequest',
          arguments: ['apiKey'],
          result: 'httpResult'
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    // Verify the activity was called with the predefined variable
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledWith('secret-key');
  });

  it('should update bindings with activity results', async () => {
    // Mock implementation that returns a specific value
    global.activities.makeHTTPRequest.mockResolvedValue('responseData');

    // Create a DSL that stores the result
    const dsl: DSL = {
      variables: {},
      root: {
        activity: {
          name: 'makeHTTPRequest',
          result: 'apiResponse'
        }
      }
    };

    const result = await DSLInterpreter(dsl, global.activities);

    // The variables should be updated with the activity result
    expect((dsl.variables as Record<string, string>)['apiResponse']).toBe('responseData');
  });

  it('should handle a complex workflow with multiple dependencies', async () => {
    // Set up mocked responses
    global.activities.makeHTTPRequest.mockResolvedValue('api_data');
    global.activities.formatData.mockImplementation((data: string) => Promise.resolve(`formatted_${data}`));
    global.activities.processResult.mockImplementation((data: string) => Promise.resolve(`processed_${data}`));
    global.activities.combineResults.mockImplementation((a: string, b: string) =>
      Promise.resolve(`combined_${a}_${b}`)
    );

    // Create a complex DSL with multiple dependencies
    const dsl: DSL = {
      variables: {
        initialParam: 'startValue'
      },
      root: {
        sequence: {
          elements: [
            // First get API data
            {
              activity: {
                name: 'makeHTTPRequest',
                arguments: ['initialParam'],
                result: 'rawData'
              }
            },
            // Then process in parallel
            {
              parallel: {
                branches: [
                  {
                    activity: {
                      name: 'formatData',
                      arguments: ['rawData'],
                      result: 'formattedOutput'
                    }
                  },
                  {
                    activity: {
                      name: 'processResult',
                      arguments: ['rawData'],
                      result: 'processedOutput'
                    }
                  }
                ]
              }
            },
            // Finally combine the results
            {
              activity: {
                name: 'combineResults',
                arguments: ['formattedOutput', 'processedOutput'],
                result: 'finalOutput'
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

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
    const dsl: DSL = {
      variables: {},
      root: {
        activity: {
          name: 'makeHTTPRequest',
          result: 'httpResult'
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
  });

  it('should handle activities without result binding', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('noBindingResult');

    const dsl: DSL = {
      variables: {},
      root: {
        activity: {
          name: 'makeHTTPRequest'
          // No result specified
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);
    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    // Verify we don't crash when no result binding is provided
    global.activities.makeHTTPRequest.mockResolvedValue('httpResult');
  });

  it('should handle deeply nested sequences and parallels', async () => {
    // Temporarily mock formatData to match the test expectations
    const originalFormatData = global.activities.formatData;
    global.activities.formatData.mockImplementation((input) => Promise.resolve('formattedData'));

    const dsl: DSL = {
      variables: {},
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                result: 'httpResult'
              }
            },
            {
              parallel: {
                branches: [
                  {
                    sequence: {
                      elements: [
                        {
                          activity: {
                            name: 'formatData',
                            arguments: ['httpResult'],
                            result: 'formattedData'
                          }
                        },
                        {
                          activity: {
                            name: 'processResult',
                            arguments: ['formattedData'],
                            result: 'processedData'
                          }
                        }
                      ]
                    }
                  },
                  {
                    activity: {
                      name: 'slowOperation',
                      result: 'slowResult'
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('httpResult');
    expect(global.activities.processResult).toHaveBeenCalledWith('formattedData');
    expect(global.activities.slowOperation).toHaveBeenCalledTimes(1);

    // Restore original mock
    global.activities.formatData = originalFormatData;
  });

  it('should handle activity arguments that are static values', async () => {
    const dsl: DSL = {
      variables: {
        staticArg1: 'value1',
        staticArg2: 'value2'
      },
      root: {
        activity: {
          name: 'combineResults',
          arguments: ['staticArg1', 'staticArg2'],
          result: 'combinedStaticResult'
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    expect(global.activities.combineResults).toHaveBeenCalledWith('value1', 'value2');
  });

  it('should support conditional execution through activities', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('true');

    const dsl: DSL = {
      variables: {},
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                result: 'condition'
              }
            },
            {
              activity: {
                name: 'conditionalTask',
                arguments: ['condition'],
                result: 'conditionalResult'
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.conditionalTask).toHaveBeenCalledWith('true');
    expect((dsl.variables as Record<string, string>)['conditionalResult']).toBe('condition met');
  });

  it('should handle activities with multiple outputs that feed into future activities', async () => {
    global.activities.makeHTTPRequest.mockResolvedValue('request_data');
    global.activities.formatData.mockResolvedValue('formatted_request_data');
    global.activities.processResult.mockResolvedValue('processed_request_data');

    const dsl: DSL = {
      variables: {},
      root: {
        sequence: {
          elements: [
            {
              activity: {
                name: 'makeHTTPRequest',
                result: 'httpData'
              }
            },
            {
              parallel: {
                branches: [
                  {
                    activity: {
                      name: 'formatData',
                      arguments: ['httpData'],
                      result: 'formattedData'
                    }
                  },
                  {
                    activity: {
                      name: 'processResult',
                      arguments: ['httpData'],
                      result: 'processedData'
                    }
                  }
                ]
              }
            },
            {
              activity: {
                name: 'combineResults',
                arguments: ['formattedData', 'processedData'],
                result: 'finalData'
              }
            }
          ]
        }
      }
    };

    await DSLInterpreter(dsl, global.activities);

    expect(global.activities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(global.activities.formatData).toHaveBeenCalledWith('request_data');
    expect(global.activities.processResult).toHaveBeenCalledWith('request_data');
    expect(global.activities.combineResults).toHaveBeenCalledWith('formatted_request_data', 'processed_request_data');
  });

  it('should throw an error if there is a circular dependency', async () => {
    // Create a DSL that directly references itself
    const dsl: DSL = {
      variables: {},
      root: {
        activity: {
          name: 'makeHTTPRequest',
          arguments: ['circularRef'], // This creates a circular dependency
          result: 'circularRef' // by using the same name for input and output
        }
      }
    };

    // Use a try-catch pattern to verify the error is thrown
    let error;
    try {
      await DSLInterpreter(dsl, global.activities);
    } catch (e) {
      error = e;
    }

    // Assert that we got an error with the expected message
    expect(error).toBeDefined();
    expect(error.message).toContain('Circular dependency detected');
  });
});
