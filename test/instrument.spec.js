import expect, { createSpy, spyOn } from 'expect';
import { createStore, compose } from 'redux';
import instrument, { ActionCreators } from '../src/instrument';

function counter(state = 0, action) {
  switch (action.type) {
  case 'INCREMENT': return state + 1;
  case 'DECREMENT': return state - 1;
  default: return state;
  }
}

function counterWithBug(state = 0, action) {
  switch (action.type) {
    case 'INCREMENT': return state + 1;
    case 'DECREMENT': return mistake - 1; // eslint-disable-line no-undef
    case 'SET_UNDEFINED': return undefined;
    default: return state;
  }
}

function doubleCounter(state = 0, action) {
  switch (action.type) {
  case 'INCREMENT': return state + 2;
  case 'DECREMENT': return state - 2;
  default: return state;
  }
}

describe('instrument', () => {
  let store;
  let liftedStore;

  beforeEach(() => {
    store = createStore(counter, instrument());
    liftedStore = store.liftedStore;
  });

  it('should perform actions', () => {
    expect(store.getState()).toBe(0);
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(1);
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(2);
  });

  it('should rollback state to the last committed state', () => {
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(2);

    liftedStore.dispatch(ActionCreators.commit());
    expect(store.getState()).toBe(2);

    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(4);

    liftedStore.dispatch(ActionCreators.rollback());
    expect(store.getState()).toBe(2);

    store.dispatch({ type: 'DECREMENT' });
    expect(store.getState()).toBe(1);

    liftedStore.dispatch(ActionCreators.rollback());
    expect(store.getState()).toBe(2);
  });

  it('should reset to initial state', () => {
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(1);

    liftedStore.dispatch(ActionCreators.commit());
    expect(store.getState()).toBe(1);

    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(2);

    liftedStore.dispatch(ActionCreators.rollback());
    expect(store.getState()).toBe(1);

    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(2);

    liftedStore.dispatch(ActionCreators.reset());
    expect(store.getState()).toBe(0);
  });

  it('should toggle an action', () => {
    // actionId 0 = @@INIT
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(1);

    liftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(store.getState()).toBe(2);

    liftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(store.getState()).toBe(1);
  });

  it('should sweep disabled actions', () => {
    // actionId 0 = @@INIT
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'INCREMENT' });

    expect(store.getState()).toBe(2);
    expect(liftedStore.getState().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
    expect(liftedStore.getState().skippedActionIds).toEqual([]);

    liftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(store.getState()).toBe(3);
    expect(liftedStore.getState().stagedActionIds).toEqual([0, 1, 2, 3, 4]);
    expect(liftedStore.getState().skippedActionIds).toEqual([2]);

    liftedStore.dispatch(ActionCreators.sweep());
    expect(store.getState()).toBe(3);
    expect(liftedStore.getState().stagedActionIds).toEqual([0, 1, 3, 4]);
    expect(liftedStore.getState().skippedActionIds).toEqual([]);
  });

  it('should jump to state', () => {
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(1);

    liftedStore.dispatch(ActionCreators.jumpToState(0));
    expect(store.getState()).toBe(0);

    liftedStore.dispatch(ActionCreators.jumpToState(1));
    expect(store.getState()).toBe(1);

    liftedStore.dispatch(ActionCreators.jumpToState(2));
    expect(store.getState()).toBe(0);

    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(0);

    liftedStore.dispatch(ActionCreators.jumpToState(4));
    expect(store.getState()).toBe(2);
  });

  it('should replace the reducer', () => {
    store.dispatch({ type: 'INCREMENT' });
    store.dispatch({ type: 'DECREMENT' });
    store.dispatch({ type: 'INCREMENT' });
    expect(store.getState()).toBe(1);

    store.replaceReducer(doubleCounter);
    expect(store.getState()).toBe(2);
  });

  it('should catch and record errors', () => {
    let spy = spyOn(console, 'error');
    let storeWithBug = createStore(counterWithBug, instrument());

    storeWithBug.dispatch({ type: 'INCREMENT' });
    storeWithBug.dispatch({ type: 'DECREMENT' });
    storeWithBug.dispatch({ type: 'INCREMENT' });

    let { computedStates } = storeWithBug.liftedStore.getState();
    expect(computedStates[2].error).toMatch(
      /ReferenceError/
    );
    expect(computedStates[3].error).toMatch(
      /Interrupted by an error up the chain/
    );
    expect(spy.calls[0].arguments[0].toString()).toMatch(
      /ReferenceError/
    );

    spy.restore();
  });

  it('should catch invalid action type', () => {
    expect(() => {
      store.dispatch({ type: undefined });
    }).toThrow(
      'Actions may not have an undefined "type" property. ' +
      'Have you misspelled a constant?'
    );
  });

  it('should return the last non-undefined state from getState', () => {
    let storeWithBug = createStore(counterWithBug, instrument());
    storeWithBug.dispatch({ type: 'INCREMENT' });
    storeWithBug.dispatch({ type: 'INCREMENT' });
    expect(storeWithBug.getState()).toBe(2);

    storeWithBug.dispatch({ type: 'SET_UNDEFINED' });
    expect(storeWithBug.getState()).toBe(2);
  });

  it('should not recompute states on every action', () => {
    let reducerCalls = 0;
    let monitoredStore = createStore(() => reducerCalls++, instrument());
    expect(reducerCalls).toBe(1);
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);
  });

  it('should not recompute old states when toggling an action', () => {
    let reducerCalls = 0;
    let monitoredStore = createStore(() => reducerCalls++, instrument());
    let monitoredLiftedStore = monitoredStore.liftedStore;

    expect(reducerCalls).toBe(1);
    // actionId 0 = @@INIT
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(3));
    expect(reducerCalls).toBe(4);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(3));
    expect(reducerCalls).toBe(5);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(reducerCalls).toBe(6);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(reducerCalls).toBe(8);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(1));
    expect(reducerCalls).toBe(10);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(reducerCalls).toBe(11);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(3));
    expect(reducerCalls).toBe(11);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(1));
    expect(reducerCalls).toBe(12);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(3));
    expect(reducerCalls).toBe(13);

    monitoredLiftedStore.dispatch(ActionCreators.toggleAction(2));
    expect(reducerCalls).toBe(15);
  });

  it('should not recompute states when jumping to state', () => {
    let reducerCalls = 0;
    let monitoredStore = createStore(() => reducerCalls++, instrument());
    let monitoredLiftedStore = monitoredStore.liftedStore;

    expect(reducerCalls).toBe(1);
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);

    let savedComputedStates = monitoredLiftedStore.getState().computedStates;

    monitoredLiftedStore.dispatch(ActionCreators.jumpToState(0));
    expect(reducerCalls).toBe(4);

    monitoredLiftedStore.dispatch(ActionCreators.jumpToState(1));
    expect(reducerCalls).toBe(4);

    monitoredLiftedStore.dispatch(ActionCreators.jumpToState(3));
    expect(reducerCalls).toBe(4);

    expect(monitoredLiftedStore.getState().computedStates).toBe(savedComputedStates);
  });

  it('should not recompute states on monitor actions', () => {
    let reducerCalls = 0;
    let monitoredStore = createStore(() => reducerCalls++, instrument());
    let monitoredLiftedStore = monitoredStore.liftedStore;

    expect(reducerCalls).toBe(1);
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    monitoredStore.dispatch({ type: 'INCREMENT' });
    expect(reducerCalls).toBe(4);

    let savedComputedStates = monitoredLiftedStore.getState().computedStates;

    monitoredLiftedStore.dispatch({ type: 'lol' });
    expect(reducerCalls).toBe(4);

    monitoredLiftedStore.dispatch({ type: 'wat' });
    expect(reducerCalls).toBe(4);

    expect(monitoredLiftedStore.getState().computedStates).toBe(savedComputedStates);
  });

  describe('Import State', () => {
    let monitoredStore;
    let monitoredLiftedStore;
    let exportedState;

    beforeEach(() => {
      monitoredStore = createStore(counter, instrument());
      monitoredLiftedStore = monitoredStore.liftedStore;
      // Set up state to export
      monitoredStore.dispatch({ type: 'INCREMENT' });
      monitoredStore.dispatch({ type: 'INCREMENT' });
      monitoredStore.dispatch({ type: 'INCREMENT' });

      exportedState = monitoredLiftedStore.getState();
    });

    it('should replay all the steps when a state is imported', () => {
      let importMonitoredStore = createStore(counter, instrument());
      let importMonitoredLiftedStore = importMonitoredStore.liftedStore;

      importMonitoredLiftedStore.dispatch(ActionCreators.importState(exportedState));
      expect(importMonitoredLiftedStore.getState()).toEqual(exportedState);
    });

    it('should replace the existing action log with the one imported', () => {
      let importMonitoredStore = createStore(counter, instrument());
      let importMonitoredLiftedStore = importMonitoredStore.liftedStore;

      importMonitoredStore.dispatch({ type: 'DECREMENT' });
      importMonitoredStore.dispatch({ type: 'DECREMENT' });

      importMonitoredLiftedStore.dispatch(ActionCreators.importState(exportedState));
      expect(importMonitoredLiftedStore.getState()).toEqual(exportedState);
    });
  });

  it('throws if reducer is not a function', () => {
    expect(() =>
      createStore(undefined, instrument())
    ).toThrow('Expected the reducer to be a function.');
  });

  it('warns if the reducer is not a function but has a default field that is', () => {
    expect(() =>
      createStore(({ 'default': () => {} }), instrument())
    ).toThrow(
      'Expected the reducer to be a function. ' +
      'Instead got an object with a "default" field. ' +
      'Did you pass a module instead of the default export? ' +
      'Try passing require(...).default instead.'
    );
  });

  it('throws if there are more than one instrument enhancer included', () => {
    expect(() => {
      createStore(counter, compose(instrument(), instrument()));
    }).toThrow(
      'DevTools instrumentation should not be applied more than once. ' +
      'Check your store configuration.'
    );
  });

  describe('replaying flag', () => {
    const TESTING_ACTION = { type: 'TESTING_ACTION' };
    const INIT_ACTION = { type: '@@INIT' };
    const TESTING_APP_STATE = 42;

    const buildTestingAction = replaying => ({ ...TESTING_ACTION, replaying });
    const buildInitAction = replaying => ({ ...INIT_ACTION, replaying });

    let spiedEmptyReducer;
    let replayingStore;
    let liftedReplayingStore;

    beforeEach(() => {
      spiedEmptyReducer = createSpy(function emptyReducer(appState = TESTING_APP_STATE) {
        return appState;
      }).andCallThrough();
      replayingStore = createStore(spiedEmptyReducer, instrument());
      liftedReplayingStore = replayingStore.liftedStore;
    });

    it('should provide falsy replaying flag when plain action is dispatched', () => {
      replayingStore.dispatch(TESTING_ACTION);
      expect(spiedEmptyReducer).toHaveBeenCalled();
      expect(spiedEmptyReducer.calls[1].arguments).toEqual([TESTING_APP_STATE, buildTestingAction(false)]);
    });

    it('should provide falsy replaying flag when PERFORM_ACTION is dispatched', () => {
      replayingStore.dispatch(TESTING_ACTION);
      liftedReplayingStore.dispatch(ActionCreators.performAction(TESTING_ACTION));
      expect(spiedEmptyReducer.calls[1].arguments).toEqual([TESTING_APP_STATE, buildTestingAction(false)]);
    });

    it('should provide truthy replaying flag for init action which follows rollback', () => {
      replayingStore.dispatch(TESTING_ACTION);
      liftedReplayingStore.dispatch(ActionCreators.rollback());
      expect(spiedEmptyReducer.calls[2].arguments).toEqual([undefined, buildInitAction(true)]);
    });

    it('should provide truthy replaying flag for init action which follows reset', () => {
      replayingStore.dispatch(TESTING_ACTION);
      liftedReplayingStore.dispatch(ActionCreators.reset());
      expect(spiedEmptyReducer.calls[2].arguments).toEqual([undefined, buildInitAction(true)]);
    });

    it('should provide truthy replaying flag for init action which follows commit', () => {
      replayingStore.dispatch(TESTING_ACTION);
      liftedReplayingStore.dispatch(ActionCreators.commit());
      expect(spiedEmptyReducer.calls[2].arguments).toEqual([42, buildInitAction(true)]);
    });

    it('should provide truthy replaying flag for all the actions after sweeping', () => {
      replayingStore.dispatch(TESTING_ACTION);
      liftedReplayingStore.dispatch(ActionCreators.sweep());
      expect(spiedEmptyReducer.calls[2].arguments).toEqual([undefined, buildInitAction(true)]);
      expect(spiedEmptyReducer.calls[3].arguments).toEqual([TESTING_APP_STATE, buildTestingAction(true)]);
    });

    it('after toggling, should provide truthy replaying flag for action which has not been toggled', () => {
      const NEXT_TESTING_ACTION = { type: 'NEXT_TESTING_ACTION' };

      replayingStore.dispatch(TESTING_ACTION);
      replayingStore.dispatch(NEXT_TESTING_ACTION);
      liftedReplayingStore.dispatch(ActionCreators.toggleAction(1));
      expect(spiedEmptyReducer.calls[3].arguments).toEqual([TESTING_APP_STATE, { ...NEXT_TESTING_ACTION, replaying: true }]);
    });

    it('should provide truthy replaying flag for all the actions after importing state', () => {
      replayingStore.dispatch(TESTING_ACTION);
      const exportedState = liftedReplayingStore.getState();

      const spiedImportStoreReducer = createSpy(function importReducer(appState = TESTING_APP_STATE) {
        return appState;
      }).andCallThrough();

      const importStore = createStore(spiedImportStoreReducer, instrument());
      importStore.liftedStore.dispatch(ActionCreators.importState(exportedState));

      expect(spiedImportStoreReducer.calls[0].arguments).toEqual([undefined, buildInitAction(false)]);
      expect(spiedImportStoreReducer.calls[1].arguments).toEqual([undefined, buildInitAction(true)]);
      expect(spiedImportStoreReducer.calls[2].arguments).toEqual([TESTING_APP_STATE, buildTestingAction(true)]);
    });
  });
});
