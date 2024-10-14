import { StateManager } from '../store/StateManager';
import { EntityAction, PARTIAL_UPDATE, reducer } from '../utils/entities';
import schemas from './testSchemas';

const { User, Nested } = schemas;
describe('StateManager', () => {
  let stateManager: StateManager;
  let dispatchSpy: jest.SpyInstance;
  let instanceNum = 0;

  beforeEach(() => {
    stateManager = StateManager.getInstance(`testInstance${++instanceNum}`);
    stateManager.state = {
      User: {
        '1': { id: '1', name: 'John Doe', nested: '100' } // Nested reference via ID
      },
      Nested: {
        '100': { id: '100', list: [10, 20] } // Nested object with a list
      }
    };
    dispatchSpy = jest.spyOn(stateManager, 'dispatch');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function applyAllPendingChanges(stateManager: StateManager) {
    console.dir(stateManager.state, { depth: 12 });
    await stateManager.processChanges();
    console.dir(stateManager.state, { depth: 12 });
  }

  it.skip('should append to the nested list using ID reference', async () => {
    stateManager.state = {
      User: {
        '1': { id: '1', name: 'John Doe', nested: '100' }
      },
      Nested: {
        '100': { id: '100', list: [10, 20] }
      }
    };

    console.dir(stateManager, { depth: 12 }); // Display initial state

    const nested = stateManager.query('Nested', '100');
    nested.list.push(21); // Modify list

    expect(dispatchSpy).toHaveBeenCalledWith(
      {
        type: PARTIAL_UPDATE,
        entityName: 'Nested',
        entityId: '100',
        updates: { '100': { list: { $push: [21] } } }
      },
      false,
      `testInstance${instanceNum}`
    );

    await applyAllPendingChanges(stateManager);
    console.dir(stateManager, { depth: 12 }); // Display initial state

    expect(stateManager.state.Nested['100'].list).toEqual([10, 20, 21]); // Assert final state
  });

  describe('Proxy Operations', () => {
    it.skip('should update the state correctly alongside dispatching the proper actions for top-level changes', async () => {
      const user = stateManager.query('User', '1');
      user.name = 'Jane Doe';

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { name: { $set: 'Jane Doe' } } }
        },
        false,
        `testInstance${instanceNum}`
      );

      // Apply changes to reflect update in state
      await applyAllPendingChanges(stateManager);

      // Ensure state was updated correctly
      expect(stateManager.state.User['1'].name).toBe('Jane Doe');
    });

    it.skip('should update the state and dispatch the proper actions for nested changes', async () => {
      stateManager.state = {
        User: {
          '1': { id: '1', attributes: { score: 10 } }
        }
      };

      const user = stateManager.query('User', '1');
      user.attributes.score = 20;

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { attributes: { score: { $set: 20 } } } }
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager); // Reflect changes in state

      expect(stateManager.state.User['1'].attributes.score).toBe(20); // Ensure state reflects update
    });

    it.skip('should handle setting array elements in state and dispatch the proper actions', async () => {
      stateManager.state = {
        User: {
          '1': { id: '1', nested: { list: [1, 2, 3] } }
        }
      };

      const user = stateManager.query('User', '1');
      user.nested.list[1] = 10;

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { nested: { list: { $splice: [[1, 1, 10]] } } } }
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.User['1'].nested.list).toEqual([1, 10, 3]);
    });

    it.skip('should handle nested array modifications correctly', async () => {
      // Initial state setup
      stateManager.state = {
        User: {
          '1': { id: '1', nested: { list: [10, 20] } }
        }
      };

      // Query and modify state
      const user = stateManager.query('User', '1');
      user.nested.list[0] = 15; // Modify element at index 0

      expect(dispatchSpy).toHaveBeenNthCalledWith(
        1,
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { nested: { list: { $splice: [[0, 1, 15]] } } } }
        },
        false,
        `testInstance${instanceNum}`
      );

      user.nested.list.push(25); // Append new element

      expect(dispatchSpy).toHaveBeenNthCalledWith(
        2,
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { nested: { list: { $push: [25] } } } }
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      console.dir(stateManager.state, { depth: 12 });
      /* 
      {
        User: {
          '1': { id: '1', nested: { list: [ 15, 20, 25, 25 ] } }
        }
      }
      */

      // Validate that the expected state is achieved
      expect(stateManager.state.User['1'].nested.list).toEqual([15, 20, 25]);
    });
  });

  describe('StateManager with ID-Based Nested References', () => {
    it.skip('should update nested list item correctly using ID reference', async () => {
      const user = stateManager.query('User', '1');
      const nested = stateManager.query('Nested', '100');
      nested.list[0] = 15; // Modify first element

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'Nested',
          entityId: '100',
          updates: { '100': { list: { $splice: [[0, 1, 15]] } } } // Correctly uses $splice
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.Nested['100'].list).toEqual([15, 20]); // Verify state update
    });

    it.skip('should append to the nested list using ID reference', async () => {
      console.dir(stateManager.state, { depth: 12 });
      const nested = stateManager.query('Nested', '100');
      console.dir(nested, { depth: 12 });
      nested.list.push(25); // Append element

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'Nested',
          entityId: '100',
          updates: { '100': { list: { $push: [25] } } } // Correctly uses $push
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);
      console.dir(stateManager.state, { depth: 12 });

      expect(stateManager.state.Nested['100'].list).toEqual([10, 20, 25]); // Verify state update
    });

    it.skip('should replace nested object reference with a new ID', async () => {
      stateManager.state = {
        User: {
          '1': { id: '1', nested: '100' } // Initially pointing to 100
        },
        Nested: {
          '100': { id: '100', list: [10, 20] },
          '101': { id: '101', list: [30, 40] } // New nested object
        }
      };

      const user = stateManager.query('User', '1');
      user.nested = '101'; // Replace the reference ID

      expect(dispatchSpy).toHaveBeenCalledWith(
        {
          type: PARTIAL_UPDATE,
          entityName: 'User',
          entityId: '1',
          updates: { '1': { nested: { $set: '101' } } } // Update the nested reference ID
        },
        false,
        `testInstance${instanceNum}`
      );

      await applyAllPendingChanges(stateManager);

      expect(stateManager.state.User['1'].nested).toBe('101'); // Ensure the reference updates
      expect(stateManager.state.Nested['101'].list).toEqual([30, 40]); // Check new nested object's presence
    });
  });
});
