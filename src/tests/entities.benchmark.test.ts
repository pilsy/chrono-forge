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

// Helper function to create test data
const createTestData = (size: number) => {
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

// Helper function to run benchmark
const runBenchmark = (name: string, fn: () => void, iterations: number = 25) => {
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
    { size: 100, name: 'small' },
    { size: 1000, name: 'medium' },
    { size: 5000, name: 'large' },
    { size: 10000, name: 'xlarge' }
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

  // Build benchmark results structure
  const benchmarkResults = OPERATIONS.reduce(
    (acc, operation) => ({
      ...acc,
      [operation]: DATASET_SIZES.reduce(
        (sizeAcc, { name }) => ({
          ...sizeAcc,
          [name]: null
        }),
        {} as Record<string, any>
      )
    }),
    {} as Record<string, Record<string, any>>
  );

  describe.each(DATASET_SIZES)('Dataset size: $name ($size)', ({ size, name }) => {
    const testData = createTestData(size);
    const state = {
      User: Object.fromEntries(testData.map((entity) => [entity.id, entity]))
    };

    it('should benchmark normalization', () => {
      const result = runBenchmark(
        'Normalization',
        () => {
          normalizeEntities(testData, schemas.User);
        },
        10
      );
      benchmarkResults['Normalization'][name] = result;
    });

    it('should benchmark single entity update', () => {
      const result = runBenchmark('Single Entity Update', () => {
        const action = updateEntity({ id: '1', name: 'Updated' }, 'User');
        reducer(state, action);
      });
      benchmarkResults['Single Entity Update'][name] = result;
    });

    it('should benchmark batch entity update', () => {
      const testUpdates = createTestData(100);
      const result = runBenchmark(
        'Batch Entity Update',
        () => {
          const action = updateEntities(testUpdates, 'User');
          reducer(state, action);
        },
        10
      );
      benchmarkResults['Batch Entity Update'][name] = result;
    });

    it('should benchmark partial entity update', () => {
      const result = runBenchmark('Partial Entity Update', () => {
        const action = updateEntityPartial({ id: '1', name: 'Updated' }, 'User');
        reducer(state, action);
      });
      benchmarkResults['Partial Entity Update'][name] = result;
    });

    it('should benchmark single entity deletion', () => {
      const result = runBenchmark('Single Entity Deletion', () => {
        const action = deleteEntity({ id: '1' }, 'User');
        reducer(state, action);
      });
      benchmarkResults['Single Entity Deletion'][name] = result;
    });

    it('should benchmark batch entity deletion', () => {
      const testDeletions = createTestData(100);
      const result = runBenchmark(
        'Batch Entity Deletion',
        () => {
          const action = deleteEntities(testDeletions, 'User');
          reducer(state, action);
        },
        10
      );
      benchmarkResults['Batch Entity Deletion'][name] = result;
    });

    it('should benchmark array push operation', () => {
      const result = runBenchmark('Array Push Operation', () => {
        const action = updateEntityPartial({ id: '1', items: [1000, 1001, 1002] }, 'User', '$push');
        reducer(state, action);
      });
      benchmarkResults['Array Push Operation'][name] = result;
    });

    it('should benchmark array splice operation', () => {
      const result = runBenchmark('Array Splice Operation', () => {
        const action = updateEntityPartial({ id: '1', items: [[500, 0, 999]] }, 'User', '$splice');
        reducer(state, action);
      });
      benchmarkResults['Array Splice Operation'][name] = result;
    });

    it('should benchmark concurrent operations', () => {
      const result = runBenchmark('Concurrent Operations', () => {
        const actions = [
          updateEntity({ id: '1', name: 'Updated 1' }, 'User'),
          updateEntity({ id: '2', name: 'Updated 2' }, 'User'),
          deleteEntity({ id: '3' }, 'User'),
          updateEntityPartial({ id: '4', name: 'Updated 4' }, 'User')
        ];

        let currentState = state;
        for (const action of actions) {
          // @ts-ignore
          currentState = reducer(currentState, action);
        }
      });
      benchmarkResults['Concurrent Operations'][name] = result;
    });
  });
  afterAll(() => {
    // Format results into a table
    const tableData = OPERATIONS.reduce(
      (acc, operation) => ({
        ...acc,
        [operation]: DATASET_SIZES.reduce(
          (sizeAcc, { size, name }) => ({
            ...sizeAcc,
            [`${name.charAt(0).toUpperCase() + name.slice(1)} (${size})`]: benchmarkResults[operation][name]
              ? `${benchmarkResults[operation][name].average.toFixed(3)}ms`
              : 'N/A'
          }),
          {}
        )
      }),
      {}
    );

    console.log('\nBenchmark Results:');
    console.table(tableData);
  });
});
