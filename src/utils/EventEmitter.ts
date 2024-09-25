export type Listener = (...args: any[]) => any;

export class EventEmitter {
  private eventListeners: Map<string, Listener[]> = new Map();

  /**
   * Adds a listener for the specified event.
   * @param event The event name.
   * @param listener The listener function.
   */
  public on(event: string, listener: Listener): this {
    const existingListeners = this.eventListeners.get(event) || [];
    existingListeners.push(listener);
    this.eventListeners.set(event, existingListeners);
    return this;
  }

  /**
   * Removes a listener for the specified event.
   * @param event The event name.
   * @param listener The listener function to remove.
   */
  public off(event: string, listener: Listener): this {
    const existingListeners = this.eventListeners.get(event);
    if (existingListeners) {
      const index = existingListeners.indexOf(listener);
      if (index !== -1) {
        existingListeners.splice(index, 1);
        if (existingListeners.length > 0) {
          this.eventListeners.set(event, existingListeners);
        } else {
          this.eventListeners.delete(event);
        }
      }
    }
    return this;
  }

  /**
   * Emits an event to all registered listeners.
   * @param event The event name.
   * @param args Arguments to pass to the listeners.
   * @returns Promise<boolean> indicating if listeners were called.
   */
  public async emit(event: string, ...args: any[]): Promise<boolean> {
    const listeners = this.eventListeners.get(event);
    if (listeners && listeners.length > 0) {
      // Copy the array to prevent modifications during iteration
      const listenersCopy = [...listeners];
      for (const listener of listenersCopy) {
        try {
          // Invoke the listener and await if it returns a Promise
          const result = listener(...args);
          if (result instanceof Promise) {
            await result;
          }
        } catch (error) {
          // Handle errors in listeners if necessary
          console.error(`Error in listener for event '${event}':`, error);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Returns the number of listeners for a given event.
   * @param event The event name.
   */
  public listenerCount(event: string): number {
    const listeners = this.eventListeners.get(event);
    return listeners ? listeners.length : 0;
  }

  /**
   * Retrieves the listeners for a given event.
   * @param event The event name.
   */
  public listeners(event: string): Listener[] {
    return this.eventListeners.get(event) || [];
  }
}
