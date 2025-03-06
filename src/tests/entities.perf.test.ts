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

// Helper function to measure execution time
const measureExecutionTime = (fn: () => void): number => {
  const start = performance.now();
  fn();
  const end = performance.now();
  return end - start;
};

// Helper function to create large test data
const createLargeDataSet = (size: number) => {
  return Array.from({ length: size }, (_, i) => ({
    id: String(i),
    name: `Entity ${i}`,
    items: Array.from({ length: 5 }, (_, j) => j),
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }));
};

type DatasetSize = 'small' | 'medium' | 'large' | 'xlarge';

describe('Entity Store Performance Tests', () => {
  const DATASET_SIZES = [
    { size: 100, name: 'small' as DatasetSize },
    { size: 1000, name: 'medium' as DatasetSize },
    { size: 5000, name: 'large' as DatasetSize },
    { size: 10000, name: 'xlarge' as DatasetSize }
  ];

  const OPERATIONS = [
    'Partial Update',
    'Array Push',
    'Array Splice',
    'Single Entity Update',
    'Single Entity Delete',
    'Batch Entity Update',
    'Batch Entity Delete',
    'Update Statement',
    'Normalization',
    'Memory Usage (MB)'
  ] as const;

  // Build performance results structure dynamically
  const performanceResults = OPERATIONS.reduce(
    (acc, operation) => ({
      ...acc,
      [operation]: DATASET_SIZES.reduce(
        (sizeAcc, { name }) => ({
          ...sizeAcc,
          [name]: 0
        }),
        {} as Record<DatasetSize, number>
      )
    }),
    {} as Record<string, Record<DatasetSize, number>>
  );

  describe.each(DATASET_SIZES)('Dataset size: $name ($size)', ({ size, name }) => {
    describe('Normalization Performance', () => {
      it('should normalize dataset efficiently', () => {
        const data = createLargeDataSet(size);
        const executionTime = measureExecutionTime(() => {
          normalizeEntities(data, schemas.User);
        });
        performanceResults['Normalization'][name] = executionTime;
        expect(executionTime).toBeLessThan(size === 100 ? 50 : size === 1000 ? 200 : 1000);
      });
    });

    describe('Update Statement Performance', () => {
      const state = {
        User: Object.fromEntries(createLargeDataSet(100).map((entity) => [entity.id, entity]))
      };

      it('should create update statement efficiently', () => {
        const updates = {
          User: Object.fromEntries(createLargeDataSet(size).map((entity) => [entity.id, entity]))
        };
        const executionTime = measureExecutionTime(() => {
          createUpdateStatement(state, updates);
        });
        performanceResults['Update Statement'][name] = executionTime;
        expect(executionTime).toBeLessThan(size === 100 ? 10 : 100);
      });
    });

    describe('Entity Update Performance', () => {
      const state = {
        User: Object.fromEntries(createLargeDataSet(size).map((entity) => [entity.id, entity]))
      };

      it('should handle single entity update efficiently', () => {
        const action = updateEntity({ id: '1', name: 'Updated' }, 'User');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Single Entity Update'][name] = executionTime;
        expect(executionTime).toBeLessThan(size * 0.1); // Allow 0.1ms per entity in state
      });

      it('should handle batch entity updates efficiently', () => {
        const entities = createLargeDataSet(size / 10);
        const action = updateEntities(entities, 'User');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Batch Entity Update'][name] = executionTime;
        expect(executionTime).toBeLessThan(size * 0.5); // Allow 0.5ms per entity
      });

      it('should handle partial updates efficiently', () => {
        const action = updateEntityPartial({ id: '1', name: 'Updated' }, 'User');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Partial Update'][name] = executionTime;
        expect(executionTime).toBeLessThan(size * 0.1); // Allow 0.1ms per entity in state
      });
    });

    describe('Entity Deletion Performance', () => {
      const state = {
        User: Object.fromEntries(createLargeDataSet(1000).map((entity) => [entity.id, entity]))
      };

      it('should handle single entity deletion efficiently', () => {
        const action = deleteEntity({ id: '1' }, 'User');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Single Entity Delete'][name] = executionTime;
        expect(executionTime).toBeLessThan(20);
      });

      it('should handle batch entity deletion efficiently', () => {
        const entities = createLargeDataSet(size / 10);
        const action = deleteEntities(entities, 'User');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Batch Entity Delete'][name] = executionTime;
        expect(executionTime).toBeLessThan(100);
      });
    });

    describe('Array Operation Performance', () => {
      const state = {
        User: {
          '1': {
            id: '1',
            items: Array.from({ length: 1000 }, (_, i) => i)
          }
        }
      };

      it('should handle array push operations efficiently', () => {
        const action = updateEntityPartial({ id: '1', items: [1000, 1001, 1002] }, 'User', '$push');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Array Push'][name] = executionTime;
        expect(executionTime).toBeLessThan(20);
      });

      it('should handle array splice operations efficiently', () => {
        const action = updateEntityPartial({ id: '1', items: [[500, 0, 999]] }, 'User', '$splice');
        const executionTime = measureExecutionTime(() => {
          reducer(state, action);
        });
        performanceResults['Array Splice'][name] = executionTime;
        expect(executionTime).toBeLessThan(25);
      });
    });
  });

  describe('Memory Usage', () => {
    it.each(DATASET_SIZES)(
      'should maintain reasonable memory usage during operations with $name dataset',
      ({ size, name }) => {
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        const initialState = {
          User: Object.fromEntries(createLargeDataSet(size).map((entity) => [entity.id, entity]))
        };

        // Take multiple measurements and average them
        const measurements: number[] = [];
        for (let run = 0; run < 3; run++) {
          const initialMemory = process.memoryUsage().heapUsed;

          // Perform multiple operations with small delays
          let state = initialState;
          for (let i = 0; i < 10; i++) {
            const action = updateEntityPartial({ id: String(i), name: `Updated ${i}` }, 'User'); // @ts-ignore
            state = reducer(state, action);
            // Small delay to allow GC to stabilize
            if (global.gc) {
              global.gc();
            }
          }

          const finalMemory = process.memoryUsage().heapUsed;
          measurements.push(Math.abs(finalMemory - initialMemory));
        }

        const averageMemoryIncrease = measurements.reduce((a, b) => a + b, 0) / measurements.length;
        performanceResults['Memory Usage (MB)'][name] = averageMemoryIncrease / (1024 * 1024);
        expect(averageMemoryIncrease).toBeLessThan(size * 1024 * 1024); // Allow 1MB per entity
      }
    );
  });

  afterAll(() => {
    // Calculate average execution time for each operation across all dataset sizes
    const operationAverages = OPERATIONS.filter((op) => op !== 'Memory Usage (MB)').reduce(
      (acc, operation) => {
        const avg =
          DATASET_SIZES.reduce((sum, { name }) => sum + performanceResults[operation][name], 0) / DATASET_SIZES.length;
        return { ...acc, [operation]: avg };
      },
      {} as Record<string, number>
    );

    // Sort operations by average execution time (descending)
    const sortedOperations = [
      ...(OPERATIONS.filter((op) => op !== 'Memory Usage (MB)').sort(
        (a, b) => operationAverages[b] - operationAverages[a]
      ) as Array<(typeof OPERATIONS)[number]>),
      'Memory Usage (MB)'
    ];

    const tableData = sortedOperations.reduce(
      (acc, operation) => ({
        ...acc,
        [operation]: DATASET_SIZES.reduce(
          (sizeAcc, { size, name }) => ({
            ...sizeAcc,
            [`${name.charAt(0).toUpperCase() + name.slice(1)} (${size})`]:
              operation === 'Memory Usage (MB)'
                ? `${performanceResults[operation][name].toFixed(2)}MB`
                : `${performanceResults[operation][name].toFixed(2)}ms`
          }),
          {}
        )
      }),
      {}
    );

    console.log('\nPerformance Test Results:');
    console.table(tableData);
  });
});
