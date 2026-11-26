import { describe, expect, it } from '@jest/globals';
import { Action, Hook, Step, Validator } from '../decorators';
import {
  ACTIONS_METADATA_KEY,
  HOOKS_METADATA_KEY,
  STEP_METADATA_KEY,
  VALIDATOR_METADATA_KEY
} from '../decorators/metadata';
import { defineMetadata, getMetadata, getOwnMetadata } from '../utils/metadata';

describe('Decorator metadata (2.0)', () => {
  it('never touches the global Reflect object', () => {
    expect((Reflect as any).defineMetadata).toBeUndefined();
    expect((Reflect as any).getMetadata).toBeUndefined();
  });

  it('stores own values and looks up the prototype chain', () => {
    class Base {}
    class Child extends Base {}
    const key = Symbol('k');
    defineMetadata(key, ['base'], Base.prototype);

    expect(getOwnMetadata(key, Child.prototype)).toBeUndefined();
    expect(getMetadata(key, Child.prototype)).toEqual(['base']);

    defineMetadata(key, ['child'], Child.prototype);
    expect(getMetadata(key, Child.prototype)).toEqual(['child']);
    expect(getMetadata(key, Base.prototype)).toEqual(['base']);
  });

  it("keeps a subclass's decorators out of its parent's metadata", () => {
    class Parent {
      @Action()
      protected async parentAction() {}

      @Validator('parentAction')
      protected validateParentAction() {}

      @Step()
      protected async parentStep() {}

      @Hook({ before: 'execute' })
      protected async parentHook() {}
    }

    class Child extends Parent {
      @Action()
      protected async childAction() {}

      @Validator('childAction')
      protected validateChildAction() {}

      @Step()
      protected async childStep() {}

      @Hook({ before: 'execute' })
      protected async childHook() {}
    }

    const methods = (key: symbol, target: object) =>
      ((getOwnMetadata<any[]>(key, target) ?? []) as { method: string }[]).map((entry) => entry.method);

    expect(methods(ACTIONS_METADATA_KEY, Parent.prototype)).toEqual(['parentAction']);
    expect(methods(ACTIONS_METADATA_KEY, Child.prototype)).toEqual(['childAction']);
    expect(getOwnMetadata(VALIDATOR_METADATA_KEY, Parent.prototype)).toEqual({ parentAction: 'validateParentAction' });
    expect(getOwnMetadata(VALIDATOR_METADATA_KEY, Child.prototype)).toEqual({ childAction: 'validateChildAction' });
    expect(methods(STEP_METADATA_KEY, Parent.prototype)).toEqual(['parentStep']);
    expect(methods(STEP_METADATA_KEY, Child.prototype)).toEqual(['childStep']);
    expect(getOwnMetadata(HOOKS_METADATA_KEY, Parent.prototype)).toEqual({
      execute: { before: ['parentHook'], after: [] }
    });
    expect(getOwnMetadata(HOOKS_METADATA_KEY, Child.prototype)).toEqual({
      execute: { before: ['childHook'], after: [] }
    });
  });
});
