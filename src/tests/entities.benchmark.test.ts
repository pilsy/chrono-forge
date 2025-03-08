import { performance } from 'perf_hooks';
import {
  reducer,
  normalizeEntities,
  createUpdateStatement,
  handleUpdateEntities,
  handleDeleteEntities
} from '../store/entities';
import {
  updateNormalizedEntities,
  deleteNormalizedEntities,
  setState,
  updateEntity,
  updateEntities,
  updateEntityPartial,
  deleteEntities,
  deleteEntity
} from '../store/actions';
import schemas from './testSchemas';

// Helper function to generate random entity data
const createRandomEntity = (id: string) => ({
  id,
  name: `Entity ${Math.random().toString(36).substring(2, 8)}`,
  items: Array.from({ length: Math.floor(Math.random() * 10) + 1 }, () => Math.floor(Math.random() * 1000)),
  metadata: {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: Array.from({ length: Math.floor(Math.random() * 5) }, () => Math.random().toString(36).substring(2, 8))
  }
});

// Helper function to create test data
const createTestData = (size: number) => {
  return Array.from({ length: size }, (_, i) => createRandomEntity(String(i)));
};

// Helper function to create random updates
const createRandomUpdates = (size: number, maxId: number) => {
  return Array.from({ length: size }, () => {
    const id = String(Math.floor(Math.random() * maxId));
    return {
      id,
      name: `Updated ${Math.random().toString(36).substring(2, 8)}`,
      items:
        Math.random() > 0.5
          ? Array.from({ length: Math.floor(Math.random() * 8) + 1 }, () => Math.floor(Math.random() * 1000))
          : undefined,
      metadata:
        Math.random() > 0.7
          ? {
              updatedAt: new Date().toISOString(),
              tags:
                Math.random() > 0.5
                  ? Array.from({ length: Math.floor(Math.random() * 3) }, () =>
                      Math.random().toString(36).substring(2, 8)
                    )
                  : undefined
            }
          : undefined
    };
  });
};

// Helper function to get random IDs from dataset
const getRandomIds = (count: number, maxId: number) => {
  const ids = new Set<string>();
  while (ids.size < count) {
    ids.add(String(Math.floor(Math.random() * maxId)));
  }
  return Array.from(ids);
};

// Helper function to run benchmark
const runBenchmark = (name: string, fn: () => void, iterations: number = 100) => {
  const times: number[] = [];

  // Warm up
  for (let i = 0; i < 10; i++) {
    fn();
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  return {
    name,
    iterations,
    average: avg,
    min,
    max,
    p95
  };
};

describe('Entity Store Benchmarks', () => {
  const DATASET_SIZES = [
    { size: 10, name: 'small' },
    { size: 100, name: 'medium' },
    { size: 1000, name: 'large' },
    { size: 2500, name: 'xlarge' }
  ];

  const OPERATIONS = [
    'Normalization',
    'Single Entity Update',
    'Batch Entity Update',
    'Partial Entity Update',
    'Single Entity Deletion',
    'Batch Entity Deletion',
    'Array Push Operation',
    'Array Splice Operation',
    'Concurrent Operations'
  ] as const;

  // Build benchmark results structure with cross-dataset metrics
  const benchmarkResults = OPERATIONS.reduce(
    (acc, operation) => ({
      ...acc,
      [operation]: DATASET_SIZES.reduce(
        (sizeAcc, { name: datasetName }) => ({
          ...sizeAcc,
          [datasetName]: DATASET_SIZES.reduce(
            (opSizeAcc, { name: opName }) => ({
              ...opSizeAcc,
              [opName]: null
            }),
            {} as Record<string, any>
          )
        }),
        {} as Record<string, Record<string, any>>
      )
    }),
    {} as Record<string, Record<string, Record<string, any>>>
  );

  // Create datasets of different sizes
  const datasets = DATASET_SIZES.reduce(
    (acc, { size, name }) => {
      acc[name] = {
        data: createTestData(size),
        size
      };
      return acc;
    },
    {} as Record<string, { data: ReturnType<typeof createTestData>; size: number }>
  );

  // Create states for each dataset size
  const states = Object.entries(datasets).reduce(
    (acc, [name, { data }]) => {
      acc[name] = {
        User: Object.fromEntries(data.map((entity) => [entity.id, entity]))
      };
      return acc;
    },
    {} as Record<string, any>
  );

  // For each dataset size (the base state)
  describe.each(DATASET_SIZES)('Dataset size: $name ($size)', ({ size, name: datasetName }) => {
    const state = states[datasetName];

    // For each operation size (the operation being performed)
    describe.each(DATASET_SIZES)('Operation size: $name ($size)', ({ size: opSize, name: opName }) => {
      it('should benchmark normalization', () => {
        // Use the operation size for the normalization test
        const testData = datasets[opName].data;
        const result = runBenchmark(
          'Normalization',
          () => {
            normalizeEntities(testData, schemas.User);
          },
          10
        );
        benchmarkResults['Normalization'][datasetName][opName] = result;
      });

      it('should benchmark single entity update', () => {
        const result = runBenchmark('Single Entity Update', () => {
          const randomId = String(Math.floor(Math.random() * size));
          const randomUpdate = createRandomEntity(randomId);
          const action = updateEntity(randomUpdate, 'User');
          reducer(state, action);
        });
        benchmarkResults['Single Entity Update'][datasetName][opName] = result;
      });

      it('should benchmark batch entity update', () => {
        // Use the operation size for the batch size
        const batchSize = Math.min(opSize, 1000); // Cap at 1000 to avoid excessive test time
        const result = runBenchmark(
          'Batch Entity Update',
          () => {
            const randomUpdates = createRandomUpdates(batchSize, size);
            const action = updateEntities(randomUpdates, 'User');
            reducer(state, action);
          },
          10
        );
        benchmarkResults['Batch Entity Update'][datasetName][opName] = result;
      });

      it('should benchmark partial entity update', () => {
        const result = runBenchmark('Partial Entity Update', () => {
          const randomId = String(Math.floor(Math.random() * size));
          const action = updateEntityPartial(
            {
              id: randomId,
              name: `Partial ${Math.random().toString(36).substring(2, 8)}`,
              'metadata.tags': Math.random() > 0.5 ? [`tag-${Date.now()}`] : undefined
            },
            'User'
          );
          reducer(state, action);
        });
        benchmarkResults['Partial Entity Update'][datasetName][opName] = result;
      });

      it('should benchmark single entity deletion', () => {
        const result = runBenchmark('Single Entity Deletion', () => {
          const randomId = String(Math.floor(Math.random() * size));
          const action = deleteEntity({ id: randomId }, 'User');
          reducer(state, action);
        });
        benchmarkResults['Single Entity Deletion'][datasetName][opName] = result;
      });

      it('should benchmark batch entity deletion', () => {
        // Use the operation size for the batch size
        const batchSize = Math.min(opSize, Math.floor(size / 2), 1000); // Cap at 1000 or half the dataset
        const result = runBenchmark(
          'Batch Entity Deletion',
          () => {
            const randomIds = getRandomIds(batchSize, size);
            const entitiesToDelete = randomIds.map((id) => ({ id }));
            const action = deleteEntities(entitiesToDelete, 'User');
            reducer(state, action);
          },
          10
        );
        benchmarkResults['Batch Entity Deletion'][datasetName][opName] = result;
      });

      it('should benchmark array push operation', () => {
        const result = runBenchmark('Array Push Operation', () => {
          const randomId = String(Math.floor(Math.random() * size));
          // Use operation size to determine array size (capped at 100)
          const arraySize = Math.min(Math.max(1, Math.floor(opSize / 100)), 100);
          const randomItems = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 1000));
          const action = updateEntityPartial({ id: randomId, items: randomItems }, 'User', '$push');
          reducer(state, action);
        });
        benchmarkResults['Array Push Operation'][datasetName][opName] = result;
      });

      it('should benchmark array splice operation', () => {
        const result = runBenchmark('Array Splice Operation', () => {
          const randomId = String(Math.floor(Math.random() * size));
          // Random splice operation: [start, deleteCount, ...items]
          const spliceOp = [
            Math.floor(Math.random() * 3), // start index
            Math.floor(Math.random() * 2), // delete count
            Math.floor(Math.random() * 1000) // item to insert
          ];
          const action = updateEntityPartial({ id: randomId, items: [spliceOp] }, 'User', '$splice');
          reducer(state, action);
        });
        benchmarkResults['Array Splice Operation'][datasetName][opName] = result;
      });

      it('should benchmark concurrent operations', () => {
        // Use operation size to determine number of operations (capped at 20)
        const numOperations = Math.min(Math.max(3, Math.floor(opSize / 500)), 20);

        const result = runBenchmark('Concurrent Operations', () => {
          // Generate a mix of random operations
          const randomIds = getRandomIds(numOperations, size);

          // First ensure the entities exist and have the required structure
          const prepActions = randomIds.map((id) => updateEntity(createRandomEntity(id), 'User'));

          let currentState = state;
          for (const action of prepActions) {
            // @ts-ignore
            currentState = reducer(currentState, action);
          }

          // Now perform the actual benchmark operations
          const actions: any[] = [];

          // Add a mix of operations based on operation size
          for (let i = 0; i < randomIds.length; i++) {
            const id = randomIds[i];
            const opType = i % 5; // Cycle through 5 operation types

            switch (opType) {
              case 0:
                actions.push(
                  updateEntity(
                    {
                      id,
                      name: `Updated ${Math.random().toString(36).substring(2, 8)}`
                    },
                    'User'
                  )
                );
                break;
              case 1:
                actions.push(
                  updateEntityPartial(
                    {
                      id,
                      name: `Partial ${Math.random().toString(36).substring(2, 8)}`
                    },
                    'User'
                  )
                );
                break;
              case 2:
                actions.push(deleteEntity({ id }, 'User'));
                break;
              case 3:
                actions.push(
                  updateEntityPartial(
                    {
                      id,
                      items: [Math.floor(Math.random() * 1000)]
                    },
                    'User',
                    '$push'
                  )
                );
                break;
              case 4:
                actions.push(
                  updateEntityPartial(
                    {
                      id,
                      items: [[0, 1, Math.floor(Math.random() * 1000)]]
                    },
                    'User',
                    '$splice'
                  )
                );
                break;
            }
          }

          for (const action of actions) {
            // @ts-ignore
            currentState = reducer(currentState, action);
          }
        });
        benchmarkResults['Concurrent Operations'][datasetName][opName] = result;
      });
    });
  });

  afterAll(() => {
    // Helper function to generate text-based heatmap indicator based on value
    const getHeatmapIndicator = (value: number, min: number, max: number) => {
      // Use symbols for heatmap visualization that work in any console
      const heatSymbols = [
        '🟢', // Green (fastest)
        '🟡', // Yellow (medium)
        '🟠', // Orange
        '🔴' // Red (slowest)
      ];

      // If min and max are the same, return middle indicator
      if (min === max) return `${value.toFixed(3)} ${heatSymbols[1]}`;

      // Calculate symbol index based on value's position between min and max
      const normalizedValue = (value - min) / (max - min);
      const symbolIndex = Math.min(heatSymbols.length - 1, Math.floor(normalizedValue * heatSymbols.length));

      return `${value.toFixed(3)} ${heatSymbols[symbolIndex]}`;
    };

    // Format results into a table for each operation
    OPERATIONS.forEach((operation) => {
      console.log(`\n${operation} Benchmark Results (ms):`);

      // Find min and max values for this operation
      let minValue = Infinity;
      let maxValue = -Infinity;

      DATASET_SIZES.forEach(({ name: datasetName }) => {
        DATASET_SIZES.forEach(({ name: opName }) => {
          const result = benchmarkResults[operation][datasetName][opName];
          if (result) {
            minValue = Math.min(minValue, result.average);
            maxValue = Math.max(maxValue, result.average);
          }
        });
      });

      // Create a table with dataset sizes as rows and operation sizes as columns
      const tableData = DATASET_SIZES.reduce(
        (acc, { name: datasetName }) => {
          acc[`Dataset: ${datasetName.charAt(0).toUpperCase() + datasetName.slice(1)}`] = DATASET_SIZES.reduce(
            (opAcc, { name: opName }) => {
              const result = benchmarkResults[operation][datasetName][opName];
              opAcc[`Op: ${opName.charAt(0).toUpperCase() + opName.slice(1)}`] = result
                ? getHeatmapIndicator(result.average, minValue, maxValue)
                : 'N/A';
              return opAcc;
            },
            {} as Record<string, string>
          );
          return acc;
        },
        {} as Record<string, Record<string, string>>
      );

      console.table(tableData);
    });

    // Also output a summary table with just dataset size operations
    console.log('\nSummary Benchmark Results (ms):');

    // Find min and max values across all operations for summary
    const summaryMinMax = OPERATIONS.reduce(
      (acc, operation) => {
        DATASET_SIZES.forEach(({ name }) => {
          const result = benchmarkResults[operation][name][name];
          if (result) {
            acc.min = Math.min(acc.min, result.average);
            acc.max = Math.max(acc.max, result.average);
          }
        });
        return acc;
      },
      { min: Infinity, max: -Infinity }
    );

    const summaryData = OPERATIONS.reduce(
      (acc, operation) => {
        // Find min and max values for this operation
        let opMinValue = Infinity;
        let opMaxValue = -Infinity;

        DATASET_SIZES.forEach(({ name }) => {
          const result = benchmarkResults[operation][name][name];
          if (result) {
            opMinValue = Math.min(opMinValue, result.average);
            opMaxValue = Math.max(opMaxValue, result.average);
          }
        });

        acc[operation] = DATASET_SIZES.reduce(
          (sizeAcc, { name }) => {
            const result = benchmarkResults[operation][name][name];
            sizeAcc[`${name.charAt(0).toUpperCase() + name.slice(1)}`] = result
              ? getHeatmapIndicator(result.average, opMinValue, opMaxValue)
              : 'N/A';
            return sizeAcc;
          },
          {} as Record<string, string>
        );
        return acc;
      },
      {} as Record<string, Record<string, string>>
    );

    console.table(summaryData);

    // Output a cross-operation comparison table
    console.log('\nCross-Operation Comparison (ms):');
    const crossOpData = OPERATIONS.reduce(
      (acc, operation) => {
        acc[operation] = DATASET_SIZES.reduce(
          (sizeAcc, { name }) => {
            const result = benchmarkResults[operation][name][name];
            sizeAcc[`${name.charAt(0).toUpperCase() + name.slice(1)}`] = result
              ? getHeatmapIndicator(result.average, summaryMinMax.min, summaryMinMax.max)
              : 'N/A';
            return sizeAcc;
          },
          {} as Record<string, string>
        );
        return acc;
      },
      {} as Record<string, Record<string, string>>
    );

    console.table(crossOpData);
  });
});
