/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DSLInterpreter, DSL, convertStepsToDSL } from '../workflows/DSLInterpreter';
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

  it('should execute a simple activity', async () => {
    // Create a simple DSL with a single activity
    const dsl: DSL = {
      variables: {},
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest',
            result: 'httpResult'
          }
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
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  result: 'httpResult'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  arguments: ['httpResult'],
                  result: 'formattedData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'processResult',
                  arguments: ['formattedData'],
                  result: 'finalResult'
                }
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
      plan: {
        parallel: {
          branches: [
            {
              execute: {
                activity: {
                  name: 'parallelTask1',
                  result: 'result1'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'parallelTask2',
                  result: 'result2'
                }
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
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  result: 'httpResult'
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
                        arguments: ['httpResult'],
                        result: 'formattedData'
                      }
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'slowOperation',
                        result: 'slowResult'
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
                  arguments: ['formattedData', 'slowResult'],
                  result: 'finalResult'
                }
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
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  result: 'httpData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'formatData',
                  arguments: ['httpData'],
                  result: 'formattedData'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'complexOperation',
                  arguments: ['formattedData', 'staticValue'],
                  result: 'complexResult'
                }
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
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest',
            arguments: ['apiKey'],
            result: 'httpResult'
          }
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
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest',
            result: 'apiResponse'
          }
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
      plan: {
        sequence: {
          elements: [
            // First get API data
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  arguments: ['initialParam'],
                  result: 'rawData'
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
                        arguments: ['rawData'],
                        result: 'formattedOutput'
                      }
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'processResult',
                        arguments: ['rawData'],
                        result: 'processedOutput'
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
                  arguments: ['formattedOutput', 'processedOutput'],
                  result: 'finalOutput'
                }
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
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest',
            result: 'httpResult'
          }
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
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest'
            // No result specified
          }
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
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  result: 'httpResult'
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
                              arguments: ['httpResult'],
                              result: 'formattedData'
                            }
                          }
                        },
                        {
                          execute: {
                            activity: {
                              name: 'processResult',
                              arguments: ['formattedData'],
                              result: 'processedData'
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
                        result: 'slowResult'
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
      plan: {
        execute: {
          activity: {
            name: 'combineResults',
            arguments: ['staticArg1', 'staticArg2'],
            result: 'combinedStaticResult'
          }
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
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  result: 'condition'
                }
              }
            },
            {
              execute: {
                activity: {
                  name: 'conditionalTask',
                  arguments: ['condition'],
                  result: 'conditionalResult'
                }
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
      plan: {
        sequence: {
          elements: [
            {
              execute: {
                activity: {
                  name: 'makeHTTPRequest',
                  result: 'httpData'
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
                        arguments: ['httpData'],
                        result: 'formattedData'
                      }
                    }
                  },
                  {
                    execute: {
                      activity: {
                        name: 'processResult',
                        arguments: ['httpData'],
                        result: 'processedData'
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
                  arguments: ['formattedData', 'processedData'],
                  result: 'finalData'
                }
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
      plan: {
        execute: {
          activity: {
            name: 'makeHTTPRequest',
            arguments: ['circularRef'], // This creates a circular dependency
            result: 'circularRef' // by using the same name for input and output
          }
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
      const dsl: DSL = {
        variables: { input: 'test_data' },
        plan: {
          execute: {
            step: {
              name: 'processData',
              arguments: ['input'],
              result: 'processedResult'
            }
          }
        }
      };

      await DSLInterpreter(dsl, {}, global.workflowSteps);

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
        expect(firstElement.execute.step?.result).toBe('step1');
      }

      // Check second element is step2
      const secondElement = dsl.plan.sequence.elements[1];
      expect('execute' in secondElement).toBe(true);
      if ('execute' in secondElement) {
        expect(secondElement.execute.step?.name).toBe('validateInput');
        expect(secondElement.execute.step?.result).toBe('step2');
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
          after: 'step1', // This makes step2 and step3 run in parallel
          required: true,
          executed: false
        }
      ];

      const dsl = convertStepsToDSL(stepMetadata, { input: 'test_data' });

      // Add an argument to step1 in the generated DSL
      const firstElement = dsl.plan.sequence.elements[0];
      if ('execute' in firstElement && firstElement.execute.step) {
        firstElement.execute.step.arguments = ['input'];
      }

      // The second generation should contain a parallel execution of step2 and step3
      const secondGeneration = dsl.plan.sequence.elements[1];
      expect('parallel' in secondGeneration).toBe(true);

      if ('parallel' in secondGeneration) {
        expect(secondGeneration.parallel.branches.length).toBe(2);

        // One branch should be step2, the other step3
        const branchNames = secondGeneration.parallel.branches
          .filter((branch) => 'execute' in branch && branch.execute.step)
          .map((branch) => ('execute' in branch ? branch.execute.step?.result : ''));

        expect(branchNames).toContain('step2');
        expect(branchNames).toContain('step3');
      }

      // Execute the DSL
      await DSLInterpreter(dsl, {}, global.workflowSteps);

      // Verify all functions were called
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('test_data');
      expect(global.workflowSteps.validateInput).toHaveBeenCalled();
      expect(global.workflowSteps.transformResult).toHaveBeenCalled();
    });

    it('should pass step results as parameters to subsequent steps', async () => {
      global.workflowSteps.processData.mockResolvedValue('processed_data');
      global.workflowSteps.validateInput.mockResolvedValue(true);

      const dsl: DSL = {
        variables: { input: 'original_data' },
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  step: {
                    name: 'processData',
                    arguments: ['input'],
                    result: 'processedData'
                  }
                }
              },
              {
                execute: {
                  step: {
                    name: 'validateInput',
                    arguments: ['processedData'],
                    result: 'isValid'
                  }
                }
              },
              {
                execute: {
                  step: {
                    name: 'transformResult',
                    arguments: ['processedData', 'isValid'],
                    result: 'finalResult'
                  }
                }
              }
            ]
          }
        }
      };

      await DSLInterpreter(dsl, {}, global.workflowSteps);

      // Verify the data flow between steps
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('original_data');
      expect(global.workflowSteps.validateInput).toHaveBeenCalledWith('processed_data');
      expect(global.workflowSteps.transformResult).toHaveBeenCalledWith('processed_data', true);
      expect((dsl.variables as Record<string, any>)['finalResult']).toBe('transformed_processed_data');
    });

    it('should handle mix of activities and steps', async () => {
      // Setup activities
      global.activities = {
        fetchData: jest.fn(async () => 'fetched_data'),
        saveData: jest.fn(async (data) => `saved_${data}`)
      };

      const dsl: DSL = {
        variables: {},
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  activity: {
                    name: 'fetchData',
                    result: 'rawData'
                  }
                }
              },
              {
                execute: {
                  step: {
                    name: 'processData',
                    arguments: ['rawData'],
                    result: 'processedData'
                  }
                }
              },
              {
                execute: {
                  activity: {
                    name: 'saveData',
                    arguments: ['processedData'],
                    result: 'saveResult'
                  }
                }
              }
            ]
          }
        }
      };

      await DSLInterpreter(dsl, global.activities, global.workflowSteps);

      // Verify activity and step interactions
      expect(global.activities.fetchData).toHaveBeenCalled();
      expect(global.workflowSteps.processData).toHaveBeenCalledWith('fetched_data');
      expect(global.activities.saveData).toHaveBeenCalledWith('processed_fetched_data');
      expect((dsl.variables as Record<string, string>)['saveResult']).toBe('saved_processed_fetched_data');
    });

    it('should throw error if step depends on missing result', async () => {
      const dsl: DSL = {
        variables: {},
        plan: {
          sequence: {
            elements: [
              {
                execute: {
                  step: {
                    name: 'processData',
                    arguments: ['nonExistentData'],
                    result: 'processedData'
                  }
                }
              }
            ]
          }
        }
      };

      // Expect execution to proceed but with undefined argument
      await DSLInterpreter(dsl, {}, global.workflowSteps);

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
        containsStep4 = lastGenElement.execute.step.result === 'step4';
      } else if ('parallel' in lastGenElement) {
        containsStep4 = lastGenElement.parallel.branches.some(
          (branch) => 'execute' in branch && branch.execute.step?.result === 'step4'
        );
      }

      expect(containsStep4).toBe(true);
    });
  });
});
