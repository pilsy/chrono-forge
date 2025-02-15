/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { StatefulWorkflowParams } from '../index';
import { v4 as uuid4 } from 'uuid';
import { SchemaManager } from '../store/SchemaManager';
import * as workflows from './testWorkflows';
import { normalizeEntities } from '../store/entities';
import { getCompositeKey, getMemo, limitRecursion } from '../utils';
import { TestAction } from './testWorkflows/ShouldExecuteStateful';

describe('StatefulWorkflow', () => {
  let execute: (
    workflowName: string,
    params: StatefulWorkflowParams,
    timeout: number
  ) => ReturnType<client.workflow.start>;
  let client: ReturnType<typeof getClient>;
  jest.setTimeout(200000);

  beforeEach(() => {
    client = getClient();

    execute = (workflowName: string, params: StatefulWorkflowParams, workflowExecutionTimeout = 120000) => {
      console.log(`Starting workflow: ${params.entityName}-${params.id}`);
      return client.workflow.start(workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout,
        workflowId: `${params.entityName}-${params.id}`,
        args: [params]
      });
    };
  });

  describe('Workflow Initialization and State Validation', () => {
    it('Should use state provided in params', async () => {
      const userId = uuid4();
      const data = {
        id: userId,
        listings: [{ id: uuid4(), name: 'Awesome test listing' }]
      };
      const normalizedData = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        state: normalizedData
      });
      await sleep();
      const state = await handle.query('state');
      expect(state).toEqual(normalizedData);
    });

    it('Should initialise state from data params', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      const state = await handle.query('state');
      expect(state).toEqual(expectedInitial);
    });

    it('Should initialize workflow without initial state', async () => {
      const userId = uuid4();
      const handle = await execute(workflows.ShouldExecuteStateful, { id: userId, entityName: 'User', state: {} });
      await sleep();
      const state = await handle.query('state');
      expect(state).toEqual({});
    });

    it('Should initialize workflow with partial data and set missing properties to defaults', async () => {
      const userId = uuid4();
      const partialData = { id: userId };
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: userId,
        entityName: 'User',
        data: partialData
      });
      await sleep();
      const state = await handle.query('state');
      expect(state).toHaveProperty('User');
      expect(state.User).toHaveProperty(userId);
    });

    it('Should initialize workflow with invalid data and handle gracefully', async () => {
      const userId = uuid4();
      const invalidData = { id: userId, invalidField: 'invalid' };
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: userId,
        entityName: 'User',
        data: invalidData
      });
      await sleep();
      const state = await handle.query('state');
      expect(state.User[userId]).toHaveProperty('invalidField');
    });
  });

  describe('ContinueAsNew', () => {
    it('Should continue as new', async () => {
      const data = { id: uuid4() };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      const state = await handle.query('state');
      expect(state).toEqual(normalizeEntities(data, SchemaManager.getInstance().getSchema('User')));
      const { state: initialMemoValue } = await getMemo(handle);
      expect(initialMemoValue).toEqual(state);

      await handle.signal('shouldContinueAsNew', true);
      await sleep(5000);

      console.log(await handle.query('state'));
    });
  });

  describe('@Debounce() decorator', () => {
    it('Should debounce properly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      const state = await handle.query('state');
      expect(state).toEqual(expectedInitial);

      const counter = await handle.query('counter');
      expect(counter).toBe(0);

      await handle.signal('incrementNumberTest');
      await sleep(15000);

      expect(await handle.query('counter')).toBe(1);
    });
  });

  describe('State Update Mechanisms', () => {
    it('Should update state correctly when there are no children', async () => {
      const data = { id: uuid4() };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      // Initial state verification
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitial);

      const initalExpectedMemo = state;
      const { state: initialMemoValue } = await getMemo(handle);
      expect(initialMemoValue).toEqual(initalExpectedMemo);

      // Update state
      const updatedData = { ...data, update: 'fromUpdate' };
      const expectedUpdated = normalizeEntities(updatedData, SchemaManager.getInstance().getSchema('User'));

      await handle.signal('update', { data: updatedData, entityName: 'User' });
      await sleep(2500);

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(expectedUpdated);

      const updatedExpectedMemo = expectedUpdated;
      const { state: updatedMemoValue } = await getMemo(handle);
      expect(updatedMemoValue).toEqual(updatedExpectedMemo);
    });

    it('Should update state and child workflow and maintain state in parent and child correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      // Initial state verification
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitial);

      const initalExpectedMemo = state;
      const { state: initialMemoValue } = await getMemo(handle);
      expect(initialMemoValue).toEqual(initalExpectedMemo);

      // Update state
      const updatedData = { ...data, update: 'fromUpdate', listings: [{ ...data.listings[0], update: 'fromUpdate' }] };
      const expectedUpdated = normalizeEntities(updatedData, SchemaManager.getInstance().getSchema('User'));

      await handle.signal('update', { data: updatedData, entityName: 'User' });
      await sleep(2500);

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(expectedUpdated);

      const updatedExpectedMemo = expectedUpdated;
      const { state: updatedMemoValue } = await getMemo(handle);
      expect(updatedMemoValue).toEqual(updatedExpectedMemo);

      // Verify child workflow state
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      const updatedListingState = await childHandle.query('state');
      expect(updatedListingState).toEqual({ Listing: expectedUpdated.Listing });

      await childHandle.signal('update', {
        data: { id: data.listings[0].id, update: 'directly' },
        entityName: 'Listing',
        strategy: '$merge'
      });
      await sleep();

      const parentData = await handle.query('state');
      const childData = await childHandle.query('state');

      expect(parentData).toEqual(
        normalizeEntities(
          { ...data, update: 'fromUpdate', listings: [{ ...data.listings[0], update: 'directly' }] },
          SchemaManager.getInstance().getSchema('User')
        )
      );
      expect(childData).toEqual({
        Listing: {
          [data.listings[0]?.id]: {
            ...data.listings[0],
            update: 'directly'
          }
        }
      });
    });

    it('Should correctly handle deep nested updates in the state', async () => {
      const id = uuid4();
      const listingId = uuid4();
      const photoId = uuid4();

      const data = {
        id,
        listings: [{ id: listingId, photos: [{ id: photoId, name: 'Nested Item', listing: listingId }] }]
      };
      const expectedInitialState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      const handle = await execute(workflows.ShouldExecuteStateful, { id, entityName: 'User', data });
      await sleep();

      const state = await handle.query('state');
      expect(state).toEqual(expectedInitialState);

      data.listings[0].photos[0].name = 'Updated Nested';
      const expectedUpdatedState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      await handle.signal('update', {
        data,
        entityName: 'User'
      });
      await sleep(2500);

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(expectedUpdatedState);
    });

    it('Should correctly handle batch updates and state synchronization across workflows', async () => {
      const data = {
        id: uuid4(),
        listings: [
          { id: uuid4(), name: 'Listing 1' },
          { id: uuid4(), name: 'Listing 2' }
        ]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      const batchUpdate = { listings: data.listings.map((listing) => ({ ...listing, updated: 'batch' })) };
      await handle.signal('update', { data: { ...data, ...batchUpdate }, entityName: 'User' });
      await sleep();

      const stateAfterBatchUpdate = await handle.query('state');
      data.listings.forEach((listing) => {
        expect(stateAfterBatchUpdate.Listing[listing.id].updated).toEqual('batch');
      });
    });

    it('Should handle different merging strategies', async () => {
      const userId = uuid4();
      const initialData = { id: userId, name: 'Initial' };
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: userId,
        entityName: 'User',
        data: initialData
      });
      await sleep();

      // Update using $merge strategy
      const updatedDataMerge = { id: userId, age: 30 };
      await handle.signal('update', { data: updatedDataMerge, entityName: 'User', strategy: '$merge' });
      await sleep();
      const mergedState = await handle.query('state');
      expect(mergedState.User[userId]).toHaveProperty('name', 'Initial');
      expect(mergedState.User[userId]).toHaveProperty('age', 30);

      // Update using $set strategy
      const updatedDataReplace = { id: userId, newField: 'Replaced' };
      await handle.signal('update', { data: updatedDataReplace, entityName: 'User', strategy: '$set' });
      await sleep();
      const replacedState = await handle.query('state');
      expect(replacedState.User[userId]).not.toHaveProperty('name');
      expect(replacedState.User[userId]).toHaveProperty('newField', 'Replaced');
    });

    it('Should maintain consistency during concurrent updates', async () => {
      const userId = uuid4();
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: userId,
        entityName: 'User',
        data: { id: userId, name: 'Initial' }
      });
      await sleep();

      await handle.signal('update', { data: { id: userId, age: 25 }, entityName: 'User' });
      await handle.signal('update', { data: { id: userId, age: 30 }, entityName: 'User' });
      await handle.signal('update', { data: { id: userId, age: 35 }, entityName: 'User' });

      await sleep();
      const state = await handle.query('state');
      expect(state.User[userId]).toHaveProperty('age', 35); // Last update should win
    });
  });

  describe('@Action', () => {
    it('Should update state and child workflow and maintain state in parent and child correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      // Initial state verification
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitial);

      // Update state
      const updatedData = {
        ...data,
        fromUpdate: 'updated',
        listings: [{ ...data.listings[0] }]
      };
      const expectedUpdated = normalizeEntities(updatedData, SchemaManager.getInstance().getSchema('User'));

      const updateId = uuid4();
      const action: TestAction = {
        actionId: updateId,
        type: 'testAction',
        payload: {
          fromUpdate: 'updated'
        }
      };

      await handle.executeUpdate('testAction', {
        args: [action],
        updateId
      });

      await sleep(2500);

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(expectedUpdated);
    });
  });

  describe('Child Workflow Management', () => {
    it('Should correctly manage one parent User and three child Listing workflows', async () => {
      // Initialize data for one User and three Listings
      const userId = uuid4();
      const listingIds = [uuid4(), uuid4(), uuid4()];
      const data = {
        id: userId,
        listings: listingIds.map((id) => ({ id, name: `Listing ${id}` }))
      };

      // Start the User workflow
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });

      // Ensure the parent User workflow is initialized with the correct normalized state
      const expectedInitialState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      const state = await handle.query('state');
      expect(state).toEqual(expectedInitialState);

      // Start child Listing workflows for each listing
      const client = getClient();
      const childHandles = await Promise.all(listingIds.map((id) => client.workflow.getHandle(`Listing-${id}`)));

      // Ensure each child Listing workflow is initialized with the correct normalized state
      for (const [index, childHandle] of childHandles.entries()) {
        await sleep();
        const listingState = await childHandle.query('state');
        expect(listingState.Listing).toEqual({
          [listingIds[index]]: { id: listingIds[index], name: `Listing ${listingIds[index]}` }
        });
      }

      // Update one of the listings in the User parent workflow
      const updatedListingData = { id: listingIds[0], name: 'Updated Listing Name' };
      const updatedData = {
        ...data,
        listings: [{ ...updatedListingData }, ...data.listings.slice(1)]
      };
      await handle.signal('update', { data: updatedData, entityName: 'User' });
      await sleep();

      // Verify that the state in the User parent workflow is updated correctly
      const updatedState = await handle.query('state');
      expect(updatedState.Listing[listingIds[0]].name).toEqual('Updated Listing Name');

      // Verify that the updated state is also reflected in the child Listing workflow
      const updatedChildState = await childHandles[0].query('state');
      expect(updatedChildState.Listing[listingIds[0]].name).toEqual('Updated Listing Name');

      // Update another listing directly in the child workflow and check propagation back to the parent
      await sleep();
      const newDirectUpdate = { id: listingIds[1], name: 'Direct Child Update' };
      await childHandles[1].signal('update', {
        data: newDirectUpdate,
        entityName: 'Listing',
        strategy: '$merge'
      });
      await sleep();

      // Verify the parent was updated!
      const parentUpdatedState = await handle.query('state');
      expect(parentUpdatedState.Listing[listingIds[1]].name).toEqual('Direct Child Update');
    });

    it('Should propagate updates correctly with multiple child workflows', async () => {
      const data = {
        id: uuid4(),
        listings: [
          { id: uuid4(), name: 'Listing One' },
          { id: uuid4(), name: 'Listing Two' }
        ]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      await sleep();

      data.listings[1].name = 'Updated Listing Two';
      await handle.signal('update', { data, entityName: 'User' });

      await sleep();

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(normalizeEntities(data, SchemaManager.getInstance().getSchema('User')));
    });

    it('Should handle recursive relationships between User and Listings correctly', async () => {
      const userId = uuid4();
      const listingId = uuid4();
      const listing2Id = uuid4();
      const photoId = uuid4();
      const photo2Id = uuid4();
      const likeId = uuid4();

      // Initial data for User with Listings, Photos, and Likes, forming a recursive structure
      const data = {
        id: userId,
        listings: [
          {
            id: listingId,
            user: userId,
            photos: [
              {
                id: photoId,
                user: userId,
                listing: listingId,
                likes: [{ id: likeId, user: userId, photo: photoId }]
              }
            ]
          },
          {
            id: listing2Id,
            user: userId
          }
        ]
      };

      // Start the User workflow
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });
      await sleep(2500); // Wait for workflows to initialize

      // Ensure the User workflow is initialized with the correct normalized state
      const expectedState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      const state = await handle.query('state');
      expect(state).toEqual(expectedState);

      const client = getClient();

      // Verify Listing workflow state for listingId
      const listingHandle = await client.workflow.getHandle(`Listing-${listingId}`);
      const listingState = await listingHandle.query('state');
      expect(listingState.Listing).toEqual(expectedState.Listing);

      // Verify Listing2 workflow state**
      const listing2Handle = await client.workflow.getHandle(`Listing-${listing2Id}`);
      const listing2State = await listing2Handle.query('state');
      expect(listing2State.Listing).toEqual(expectedState.Listing);

      // Verify child Photo workflow state
      const photoHandle = await client.workflow.getHandle(`Photo-${photoId}`);
      const photoState = await photoHandle.query('state');
      expect(photoState.Photo).toEqual({
        [photoId]: {
          id: photoId,
          user: userId,
          listing: listingId,
          likes: [likeId]
        }
      });

      // Verify child Like workflow state
      const likeHandle = await client.workflow.getHandle(`Like-${likeId}`);
      const likeState = await likeHandle.query('state');
      expect(likeState.Like).toEqual({
        [likeId]: { id: likeId, user: userId, photo: photoId }
      });

      // Update Listing data and propagate to children
      expectedState.Listing[listingId].name = 'Updated Listing 1 Name';
      expectedState.Listing[listing2Id].name = 'Updated Listing 2 Name';
      let expectedData = limitRecursion(userId, 'User', expectedState);

      await handle.signal('update', {
        data: expectedData,
        entityName: 'User'
      });
      await sleep(2500); // Wait for state to propagate

      // Verify state update propagation in User
      const updatedState = await handle.query('state');
      expect(updatedState.Listing[listingId].name).toEqual('Updated Listing 1 Name');
      expect(updatedState.Listing[listing2Id].name).toEqual('Updated Listing 2 Name');

      // Verify the state update is reflected in the Listing child workflow
      let updatedListingState = await listingHandle.query('state');
      expect(updatedListingState.Listing[listingId].name).toEqual('Updated Listing 1 Name');

      let updatedListing2State = await listing2Handle.query('state');
      expect(updatedListing2State.Listing[listing2Id].name).toEqual('Updated Listing 2 Name');

      // Update one of the listings directly, and verify its state**
      const updatedListing2Data = {
        id: listing2Id,
        user: userId,
        name: 'Updated Listing2 Name',
        photos: [
          {
            id: photo2Id,
            user: userId,
            listing: listing2Id
          }
        ]
      };
      await listing2Handle.signal('update', {
        data: updatedListing2Data,
        entityName: 'Listing'
      });
      await sleep(2500); // Wait for state to propagate

      // Verify the state update in Listing2 workflow
      updatedListing2State = await listing2Handle.query('state');
      console.log(updatedListing2State);
      expect(updatedListing2State.Listing[listing2Id].name).toEqual('Updated Listing2 Name');

      // Verify it propagates up to the parent by checking parent state**
      const updatedUserState = await handle.query('state');
      expect(updatedUserState.Listing[listing2Id].name).toEqual('Updated Listing2 Name');

      // Verify both listings are still referenced in the state of the parent correctly**
      expect(updatedUserState.Listing).toHaveProperty(listingId);
      expect(updatedUserState.Listing).toHaveProperty(listing2Id);

      // Optionally, verify the full listing objects
      expect(updatedUserState.Listing[listingId]).toEqual(
        expect.objectContaining({
          id: listingId,
          user: userId,
          name: 'Updated Listing 1 Name'
        })
      );
      expect(updatedUserState.Listing[listing2Id]).toEqual(
        expect.objectContaining({
          id: listing2Id,
          user: userId,
          name: 'Updated Listing2 Name'
        })
      );
    });

    it('Should handle restarting child workflow after cancellation', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Test Listing' }] };
      await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      await childHandle.cancel();
      await sleep();

      const restartedChildHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      await sleep();
      const childState = await restartedChildHandle.query('state');
      expect(childState.Listing).toHaveProperty(data.listings[0].id);
    });

    it('Should cancel children upon parent cancellation', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Test Listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      expect(await handle.query('data')).toEqual(data);
      await handle.cancel();
      await sleep();

      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      const { status: childStatus } = await childHandle.describe();
      expect(childStatus.name).toBe('CANCELLED');
    });

    it('Should handle completed child workflow and maintain state in the parent', async () => {
      const listing = { id: uuid4(), name: 'Test Listing' };
      const data = { id: uuid4(), listings: [listing] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      const client = getClient();
      const childHandle = client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      await childHandle.signal('status', 'completed');
      const childCompletedData = await childHandle.result();
      expect(childCompletedData).toEqual(listing);

      const parentData = await handle.query('data');
      expect(parentData).toEqual(data);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('Should handle invalid state query by returning error', async () => {
      const userId = uuid4();
      const handle = await execute(workflows.ShouldExecuteStateful, { id: userId, entityName: 'User', state: {} });
      await sleep();

      try {
        await handle.query('invalidState');
        fail('Expected an error for invalid state query');
      } catch (e) {
        expect(e.message).toContain('did not register a handler');
      }
    });

    it('Should recover from signal errors and maintain state integrity', async () => {
      const userId = uuid4();
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: userId,
        entityName: 'User',
        state: { User: { [userId]: { id: userId, name: 'Initial' } } }
      });
      await sleep();

      try {
        await handle.signal('update', { data: null, entityName: 'User' }); // Invalid data
      } catch (e) {
        expect(e.message).toContain('Invalid data');
      }
      await sleep();
      const state = await handle.query('state');
      expect(state.User[userId]).toHaveProperty('name', 'Initial');
    });
  });

  describe('Performance and Scalability', () => {
    it('Should handle rapid succession of updates correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      for (let i = 0; i < 5; i++) {
        data.listings[0].name = `Update-${i}`;
        await handle.signal('update', { data, entityName: 'User' });
      }

      await sleep(10000);

      const finalState = await handle.query('state');
      expect(finalState).toEqual(normalizeEntities(data, SchemaManager.getInstance().getSchema('User')));
    });

    it('Should handle a high volume of state changes without degradation', async () => {
      const userId = uuid4();
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: userId,
        entityName: 'User',
        data: { id: userId, name: 'Initial' }
      });
      await sleep();

      const updates = Array.from({ length: 50 }, (_, i) => ({
        id: userId,
        name: `Update-${i}`
      }));

      for (const update of updates) {
        await handle.signal('update', { data: update, entityName: 'User' });
      }

      await sleep(2500);
      const finalState = await handle.query('state');
      expect(finalState.User[userId].name).toEqual('Update-49');
    });

    it('Should manage circular relationships without causing infinite loops', async () => {
      const userId = uuid4();
      const listingId = uuid4();
      const data = {
        id: userId,
        listings: [{ id: listingId, content: 'Hello World', user: userId }]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep(2500);

      const initialState = await handle.query('state');
      expect(initialState).toEqual(normalizeEntities(data, SchemaManager.getInstance().getSchema(`User`)));

      data.listings[0].content = 'Updated Content';
      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${listingId}`);
      await childHandle.signal('update', { data: data.listings[0], entityName: 'Listing' });

      await sleep(2500);

      const parentData = await handle.query('state');
      expect(parentData.Listing[data.listings[0].id].content).toEqual('Updated Content');
    });
  });

  describe('Schema and Data Integrity', () => {
    it('Should handle circular references correctly when updating nested entities', async () => {
      const userId = uuid4();
      const listingId = uuid4();
      const photoId = uuid4();
      const likeId = uuid4();

      // Circular data structure where a user likes a photo that belongs to them via a listing
      const data = {
        id: userId,
        listings: [
          {
            id: listingId,
            user: userId,
            photos: [
              { id: photoId, user: userId, listing: listingId, likes: [{ id: likeId, user: userId, photo: photoId }] }
            ]
          }
        ]
      };

      // Start User workflow
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });
      await sleep(2500);

      // Verify the User workflow is initialized correctly with normalized state
      const expectedInitialState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitialState);

      // Start child Listing and Like workflows
      const client = getClient();
      await client.workflow.getHandle(`Listing-${listingId}`);
      const likeHandle = await client.workflow.getHandle(`Like-${likeId}`);

      // Update the Like entity directly in the child workflow
      await likeHandle.signal('update', {
        data: { id: likeId, user: userId, newField: 'direct update' },
        entityName: 'Like'
      });
      await sleep(2500);

      // Verify that the state in the parent User workflow is updated correctly
      const parentUpdatedState = await handle.query('state');
      expect(parentUpdatedState.Like[likeId].newField).toEqual('direct update');
    });
  });

  describe('getCompositeKey', () => {
    it('should generate a composite key from single-level attributes', () => {
      const entity = {
        id: '123',
        type: 'abc'
      };
      const idAttributes = ['id', 'type'];

      const compositeKey = getCompositeKey(entity, idAttributes);
      expect(compositeKey).toBe('123-abc');
    });

    it('should generate a composite key from nested attributes', () => {
      const entity = {
        user: {
          id: '123',
          type: 'abc'
        }
      };
      const idAttributes = ['user.id', 'user.type'];

      const compositeKey = getCompositeKey(entity, idAttributes);
      expect(compositeKey).toBe('123-abc');
    });

    it('should generate a composite key from mixed attributes', () => {
      const entity = {
        id: '123',
        details: {
          type: 'abc'
        }
      };
      const idAttributes = ['id', 'details.type'];

      const compositeKey = getCompositeKey(entity, idAttributes);
      expect(compositeKey).toBe('123-abc');
    });

    it('should handle missing attributes gracefully', () => {
      const entity = {
        id: '123'
      };
      const idAttributes = ['id', 'type'];

      const compositeKey = getCompositeKey(entity, idAttributes);
      expect(compositeKey).toBe('123-');
    });

    it('should handle empty idAttributes array', () => {
      const entity = {
        id: '123',
        type: 'abc'
      };
      const idAttributes: string[] = [];

      const compositeKey = getCompositeKey(entity, idAttributes);
      expect(compositeKey).toBe('');
    });
  });
});
