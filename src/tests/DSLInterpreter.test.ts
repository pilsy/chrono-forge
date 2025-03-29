import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DSLInterpreter, DSL } from '../workflows/DSLInterpreter';

// Mock the @temporalio/workflow module first
jest.mock('@temporalio/workflow', () => {
  // Create mock activities inline within the mock
  const mockActs = {
    // @ts-ignore
    makeHTTPRequest: jest.fn().mockResolvedValue('httpResult'), // @ts-ignore
    formatData: jest.fn().mockResolvedValue('formattedData'), // @ts-ignore
    processResult: jest.fn().mockResolvedValue('processedResult'), // @ts-ignore
    slowOperation: jest.fn().mockResolvedValue('slowResult'), // @ts-ignore
    parallelTask1: jest.fn().mockResolvedValue('parallelResult1'), // @ts-ignore
    parallelTask2: jest.fn().mockResolvedValue('parallelResult2'), // @ts-ignore
    combineResults: jest.fn().mockResolvedValue('combinedResult'), // @ts-ignore
    complexOperation: jest.fn().mockResolvedValue('complexResult')
  };

  return {
    proxyActivities: jest.fn(() => mockActs)
  };
});

// Import the mocked functions for testing
// @ts-ignore
const { proxyActivities } = jest.requireMock('@temporalio/workflow');
const mockActivities = proxyActivities();

describe('DSLInterpreter', () => {
  beforeEach(() => {
    // Reset mocks before each test
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

    await DSLInterpreter(dsl);

    // Verify the activity was called
    expect(mockActivities.makeHTTPRequest).toHaveBeenCalledTimes(1);
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

    await DSLInterpreter(dsl);

    // Verify the activities were called in order
    expect(mockActivities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(mockActivities.formatData).toHaveBeenCalledTimes(1);
    expect(mockActivities.formatData).toHaveBeenCalledWith('httpResult');
    expect(mockActivities.processResult).toHaveBeenCalledTimes(1);
    expect(mockActivities.processResult).toHaveBeenCalledWith('formattedData');
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

    await DSLInterpreter(dsl);

    // Verify both parallel activities were called
    expect(mockActivities.parallelTask1).toHaveBeenCalledTimes(1);
    expect(mockActivities.parallelTask2).toHaveBeenCalledTimes(1);
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

    await DSLInterpreter(dsl);

    // Verify the sequence of calls
    expect(mockActivities.makeHTTPRequest).toHaveBeenCalledTimes(1);

    // Both formatData and slowOperation should be called
    expect(mockActivities.formatData).toHaveBeenCalledTimes(1);
    expect(mockActivities.formatData).toHaveBeenCalledWith('httpResult');
    expect(mockActivities.slowOperation).toHaveBeenCalledTimes(1);

    // combineResults should be called with both results
    expect(mockActivities.combineResults).toHaveBeenCalledTimes(1);
    expect(mockActivities.combineResults).toHaveBeenCalledWith('formattedData', 'slowResult');
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

    await DSLInterpreter(dsl);

    // Verify the activities were called with correct arguments
    expect(mockActivities.makeHTTPRequest).toHaveBeenCalledTimes(1);
    expect(mockActivities.formatData).toHaveBeenCalledWith('httpResult');
    expect(mockActivities.complexOperation).toHaveBeenCalledWith('formattedData', 'someConstant');
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

    await DSLInterpreter(dsl);

    // Verify the activity was called with the predefined variable
    expect(mockActivities.makeHTTPRequest).toHaveBeenCalledWith('secret-key');
  });

  it('should update bindings with activity results', async () => {
    // Mock implementation that returns a specific value
    mockActivities.makeHTTPRequest.mockResolvedValue('responseData');

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

    const result = await DSLInterpreter(dsl);

    // The variables should be updated with the activity result
    expect((dsl.variables as Record<string, string>)['apiResponse']).toBe('responseData');
  });

  it('should handle a complex workflow with multiple dependencies', async () => {
    // Set up mocked responses
    mockActivities.makeHTTPRequest.mockResolvedValue('api_data');
    mockActivities.formatData.mockImplementation((data: string) => Promise.resolve(`formatted_${data}`));
    mockActivities.processResult.mockImplementation((data: string) => Promise.resolve(`processed_${data}`));
    mockActivities.combineResults.mockImplementation((a: string, b: string) => Promise.resolve(`combined_${a}_${b}`));

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

    await DSLInterpreter(dsl);

    // Verify the execution flow
    expect(mockActivities.makeHTTPRequest).toHaveBeenCalledWith('startValue');
    expect(mockActivities.formatData).toHaveBeenCalledWith('api_data');
    expect(mockActivities.processResult).toHaveBeenCalledWith('api_data');
    expect(mockActivities.combineResults).toHaveBeenCalledWith('formatted_api_data', 'processed_api_data');

    // Verify the final result
    expect((dsl.variables as Record<string, string>)['finalOutput']).toBe(
      'combined_formatted_api_data_processed_api_data'
    );
  });
});
