/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import path from 'path';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { Workflow, ChronoFlow, StatefulWorkflowParams } from '../index';
import { Signal, Query } from '../decorators';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { WorkflowClient } from '@temporalio/client';
import { v4 as uuid4 } from 'uuid';
import { SchemaManager } from '../SchemaManager';
import * as workflows from './testWorkflows';
import { logger } from '../utils/logger';
import { OpenTelemetryActivityInboundInterceptor, makeWorkflowExporter } from '@temporalio/interceptors-opentelemetry/lib/worker';
import { normalizeEntities } from '../utils/entities';
import { getExternalWorkflowHandle } from '@temporalio/workflow';
import { cloneDeep } from 'lodash';
import dottie, { get, set } from 'dottie';
import { getExporter, getResource, getTracer } from '../utils/instrumentation';
import { Photo } from './testSchemas';
import { getCompositeKey } from './../utils';

describe('StatefulWorkflow', () => {
  let execute: (workflowName: string, params: StatefulWorkflowParams, timeout: number) => ReturnType<client.workflow.start>;

  beforeEach(() => {
    const client = getClient();

    execute = (workflowName: string, params: StatefulWorkflowParams, workflowExecutionTimeout = 30000) => {
      console.log(`Starting workflow: ${params.entityName}-${params.id}`);
      return client.workflow.start(workflowName, {
        taskQueue: 'test',
        workflowExecutionTimeout,
        workflowId: `${params.entityName}-${params.id}`,
        args: [params]
      });
    };
  });

  describe('Workflow State Management', () => {
    it('Should use state provided in params', async () => {
      const userId = uuid4();
      const data = {
        id: userId,
        listings: [{ id: uuid4(), name: 'Awesome test listing' }]
      };
      const normalizedData = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));

      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', state: normalizedData });
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

    it('Should update state and child workflow and maintain state in parent and child correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      const expectedInitial = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      await sleep();

      // Initial state verification
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitial);

      // Update state
      const updatedData = { ...data, update: 'fromUpdate', listings: [{ ...data.listings[0], update: 'fromUpdate' }] };
      const expectedUpdated = normalizeEntities(updatedData, SchemaManager.getInstance().getSchema('User'));

      await handle.signal('update', { data: updatedData, entityName: 'User' });
      await sleep(3000);

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(expectedUpdated);

      // Verify child workflow state
      const client = getClient();
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

    it('Should handle recursive relationships between User and Listings correctly', async () => {
      const userId = uuid4();
      const listingId = uuid4();
      const photoId = uuid4();
      const likeId = uuid4();

      // Initial data for User with Listing, Photo, and Like, forming a recursive structure
      const data = {
        id: userId,
        listings: [
          {
            id: listingId,
            user: userId,
            photos: [{ id: photoId, user: userId, listing: listingId, likes: [{ id: likeId, user: userId, photo: photoId }] }]
          }
        ]
        // photos: [{ id: photoId, user: userId, listing: listingId }]
        // likes: [{ id: likeId, user: userId, photo: photoId }]
      };

      // Start the User workflow
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });
      await sleep();

      // Ensure the User workflow is initialized with the correct normalized state
      const expectedInitialState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitialState);

      // Start child Listing workflow
      const client = getClient();
      const listingHandle = await client.workflow.getHandle(`Listing-${listingId}`);

      // Verify Listing workflow state
      const listingState = await listingHandle.query('state');
      expect(listingState.Listing).toEqual({
        [listingId]: { id: listingId, user: userId, photos: [photoId] }
      });

      // Verify child Photo workflow state
      const photoHandle = await client.workflow.getHandle(`Photo-${photoId}`);
      const photoState = await photoHandle.query('state');
      expect(photoState.Photo).toEqual({
        [photoId]: { id: photoId, user: userId, listing: listingId, likes: [likeId] }
      });

      // Verify child Like workflow state
      const likeHandle = await client.workflow.getHandle(`Like-${likeId}`);
      const likeState = await likeHandle.query('state');
      expect(likeState.Like).toEqual({
        [likeId]: { id: likeId, user: userId, photo: photoId }
      });

      // Update Listing data and propagate to children
      const updatedListingData = { id: listingId, user: userId, name: 'Updated Listing Name' };
      await handle.signal('update', { data: { ...data, listings: [{ ...updatedListingData }] }, entityName: 'User' });
      await sleep();

      // Verify state update propagation in User
      const updatedState = await handle.query('state');
      expect(updatedState.Listing[listingId].name).toEqual('Updated Listing Name');

      // Verify the state update is reflected in the Listing child workflow
      const updatedListingState = await listingHandle.query('state');
      expect(updatedListingState.Listing[listingId].name).toEqual('Updated Listing Name');
    });

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
            photos: [{ id: photoId, user: userId, listing: listingId, likes: [{ id: likeId, user: userId, photo: photoId }] }]
          }
        ]
      };

      // Start User workflow
      const handle = await execute(workflows.ShouldExecuteStateful, {
        id: data.id,
        entityName: 'User',
        data
      });
      await sleep();

      // Verify the User workflow is initialized correctly with normalized state
      const expectedInitialState = normalizeEntities(data, SchemaManager.getInstance().getSchema('User'));
      const state = await handle.query('state');
      expect(state).toEqual(expectedInitialState);

      // Start child Listing and Like workflows
      const client = getClient();
      const listingHandle = await client.workflow.getHandle(`Listing-${listingId}`);
      const likeHandle = await client.workflow.getHandle(`Like-${likeId}`);

      // Update the Like entity directly in the child workflow
      await likeHandle.signal('update', { data: { id: likeId, user: userId, newField: 'direct update' }, entityName: 'Like' });
      await sleep();

      // Verify that the state in the parent User workflow is updated correctly
      const parentUpdatedState = await handle.query('state');
      expect(parentUpdatedState.Like[likeId].newField).toEqual('direct update');
    }, 45000);

    it('Should correctly handle deep nested updates in the state', async () => {
      const id = uuid4();
      const listingId = uuid4();
      const photoId = uuid4();

      const data = { id, listings: [{ id: listingId, photos: [{ id: photoId, name: 'Nested Item', listing: listingId }] }] };
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
      await sleep();

      const updatedState = await handle.query('state');
      expect(updatedState).toEqual(expectedUpdatedState);
    }, 45000);

    it.skip('Should handle child workflow cancellation and reflect in parent state', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Awesome test listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${data.listings[0].id}`);
      await childHandle.cancel();
      await sleep();

      const parentState = await handle.query('state');
      expect(parentState.Listing).not.toHaveProperty(data.listings[0].id);
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

    it('Should manage circular relationships without causing infinite loops', async () => {
      const userId = uuid4();
      const listingId = uuid4();
      const data = {
        id: userId,
        listings: [{ id: listingId, content: 'Hello World', user: userId }]
      };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });
      await sleep();

      const initialState = await handle.query('state');
      expect(initialState).toEqual(normalizeEntities(data, SchemaManager.getInstance().getSchema(`User`)));

      data.listings[0].content = 'Updated Content';
      const client = getClient();
      const childHandle = await client.workflow.getHandle(`Listing-${listingId}`);
      await childHandle.signal('update', { data: data.listings[0], entityName: 'Listing' });

      await sleep();

      const parentData = await handle.query('state');
      expect(parentData.Listing[data.listings[0].id].content).toEqual('Updated Content');
    });

    it('Should handle rapid succession of updates correctly', async () => {
      const data = { id: uuid4(), listings: [{ id: uuid4(), name: 'Listing' }] };
      const handle = await execute(workflows.ShouldExecuteStateful, { id: data.id, entityName: 'User', data });

      for (let i = 0; i < 5; i++) {
        data.listings[0].name = `Update-${i}`;
        await handle.signal('update', { data, entityName: 'User' });
      }

      await sleep();

      const finalState = await handle.query('state');
      expect(finalState).toEqual(normalizeEntities(data, SchemaManager.getInstance().getSchema('User')));
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

      const batchUpdate = { listings: data.listings.map((listing) => ({ ...listing, updated: 'batch' })) };
      await handle.signal('update', { data: { ...data, ...batchUpdate }, entityName: 'User' });
      await sleep();

      const stateAfterBatchUpdate = await handle.query('state');
      data.listings.forEach((listing) => {
        expect(stateAfterBatchUpdate.Listing[listing.id].updated).toEqual('batch');
      });
    });
  });
});
