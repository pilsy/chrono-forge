# `@Mutex` Decorator

## Introduction to the `@Mutex` Decorator

The `@Mutex` decorator in ChronoForge provides a mechanism for ensuring exclusive method execution, preventing concurrent access to critical sections of code. It implements a mutual exclusion pattern that guarantees only one execution of a decorated method can occur at a time within the same class instance. This is particularly valuable for methods that modify shared state or access resources that aren't designed for concurrent operations.

## Purpose of the `@Mutex` Decorator

The primary purposes of the `@Mutex` decorator are:

- **Thread Safety**: Ensure only one execution of the method at a time
- **Instance-Level Locking**: Provide mutex locks scoped to class instances
- **Named Locks**: Support for multiple named mutexes within the same instance
- **Race Condition Prevention**: Avoid conflicts in shared resource access

## How the `@Mutex` Decorator Works

The `@Mutex` decorator uses the `async-mutex` library to implement its functionality:

1. Each class instance maintains a map of mutex locks, identified by name
2. When a decorated method is called, it acquires the mutex lock before execution
3. If the lock is already held, the method call waits until the lock is released
4. After the method execution completes (or throws an error), the lock is automatically released
5. Methods sharing the same mutex name will be mutually exclusive

This implementation ensures that:

- Methods execute sequentially rather than concurrently
- Each class instance has its own set of locks
- Different methods can share the same lock if needed
- Locks are automatically released after execution

## Usage Examples

### Basic Usage

```typescript
import { Workflow, Mutex } from 'chrono-forge';

class AccountWorkflow extends Workflow {
  private balance = 1000;
  
  @Mutex() // Uses default mutex name 'execute'
  protected async withdraw(amount: number): Promise<number> {
    // This method will execute exclusively - only one withdraw operation
    // can happen at a time for this instance
    if (amount > this.balance) {
      throw new Error('Insufficient funds');
    }
    
    // Even if multiple calls come in simultaneously, the mutex
    // ensures they execute one after another
    this.balance -= amount;
    this.log.info(`Withdrew ${amount}, new balance: ${this.balance}`);
    
    return this.balance;
  }
}
```

### Using Named Mutexes

```typescript
class ResourceWorkflow extends Workflow {
  @Mutex('database') // Uses 'database' named mutex
  protected async saveToDatabase(data: any): Promise<void> {
    // This method has exclusive access to database operations
    this.log.info(`Saving data to database`);
    await this.dbService.save(data);
  }
  
  @Mutex('database') // Shares the same 'database' mutex
  protected async queryDatabase(id: string): Promise<any> {
    // This method won't run concurrently with saveToDatabase since they share the same mutex
    this.log.info(`Querying database for ${id}`);
    return await this.dbService.query(id);
  }
  
  @Mutex('fileSystem') // Uses 'fileSystem' named mutex
  protected async writeToFile(path: string, content: string): Promise<void> {
    // This method can run concurrently with database methods
    // since it uses a different mutex
    this.log.info(`Writing to file: ${path}`);
    await this.fileService.write(path, content);
  }
}
```

### Protecting State Updates

```typescript
class StateWorkflow extends Workflow {
  private state: any = {
    items: [],
    count: 0,
    status: 'idle'
  };
  
  @Mutex('state')
  protected async addItem(item: any): Promise<void> {
    // Ensure atomic state updates
    this.state.items.push(item);
    this.state.count++;
    this.state.status = 'updated';
    
    this.log.info(`Added item, new count: ${this.state.count}`);
    await this.notifyStateChange();
  }
  
  @Mutex('state')
  protected async removeItem(id: string): Promise<void> {
    // This won't run concurrently with addItem
    const index = this.state.items.findIndex(item => item.id === id);
    if (index >= 0) {
      this.state.items.splice(index, 1);
      this.state.count--;
      this.state.status = 'updated';
      
      this.log.info(`Removed item, new count: ${this.state.count}`);
      await this.notifyStateChange();
    }
  }
  
  private async notifyStateChange(): Promise<void> {
    // Notification logic...
  }
}
```

## Advanced Usage

### Combining with Other Decorators

The `@Mutex` decorator can be combined with other decorators:

```typescript
class DataWorkflow extends Workflow {
  @Mutex('data')
  @Debounce(300)
  protected async updateData(newData: any): Promise<void> {
    // This method is both debounced (only the last call within 300ms executes)
    // and mutex-protected (only one execution at a time)
    this.log.info(`Updating data`);
    
    // Data update logic...
    await this.dataService.update(newData);
  }
  
  @Mutex('data')
  @Guard(function(query: string) {
    return query.length >= 3;
  })
  protected async searchData(query: string): Promise<any[]> {
    // This method is guard-protected and mutex-protected
    this.log.info(`Searching data for: ${query}`);
    
    // Search logic...
    return await this.dataService.search(query);
  }
}
```

### Implementing Resource Pools

Using named mutexes, you can implement a simple resource pool pattern:

```typescript
class ConnectionPoolWorkflow extends Workflow {
  private connectionPool = ['conn1', 'conn2', 'conn3'];
  
  @Mutex('connPool')
  protected async getConnection(): Promise<string> {
    if (this.connectionPool.length === 0) {
      throw new Error('No connections available');
    }
    
    const connection = this.connectionPool.pop();
    this.log.info(`Acquired connection: ${connection}`);
    return connection;
  }
  
  @Mutex('connPool')
  protected async releaseConnection(connection: string): Promise<void> {
    this.connectionPool.push(connection);
    this.log.info(`Released connection: ${connection}`);
  }
  
  async executeQuery(query: string): Promise<any> {
    const connection = await this.getConnection();
    try {
      // Use the connection...
      const result = await this.databaseService.executeQuery(connection, query);
      return result;
    } finally {
      // Always release the connection
      await this.releaseConnection(connection);
    }
  }
}
```

## Best Practices

### 1. Use Specific Mutex Names

Name your mutexes according to the resources or state they protect, making the code more maintainable and the locking behavior more predictable.

### 2. Keep Critical Sections Short

Mutex-protected methods should execute quickly to avoid blocking other operations. If a method needs to perform long-running operations, consider restructuring it to minimize the locked portion.

```typescript
// Prefer this:
async processLargeDataset(data: any[]): Promise<void> {
  // Prepare data outside the lock
  const processedData = await this.prepareData(data);
  
  // Only lock during the critical section
  await this.updateDatabaseWithProcessedData(processedData);
}

@Mutex('database')
private async updateDatabaseWithProcessedData(data: any): Promise<void> {
  // Critical section - keep it short
  await this.dbService.bulkUpdate(data);
}
```

### 3. Be Careful with Nested Locks

Avoid having a mutex-protected method call another mutex-protected method with the same mutex name, as this can lead to deadlocks in some implementations.

### 4. Handle Errors Properly

Ensure errors are properly caught and handled, as the mutex will be released automatically even if the method throws an exception.

```typescript
@Mutex('resource')
async accessResource(): Promise<void> {
  try {
    // Access the resource
  } catch (error) {
    this.log.error(`Resource access failed: ${error.message}`);
    // Handle the error appropriately
    throw error; // Re-throw if needed
  }
  // Mutex is released automatically, even if an error occurs
}
```

### 5. Consider Performance Implications

Using mutexes introduces serialization, which can impact performance if overused. Only apply mutexes where concurrent access would cause issues.

## Integration with Workflow Features

The `@Mutex` decorator integrates well with other workflow features:

- **Signals**: Protect signal handlers from concurrent execution
- **State Management**: Ensure atomic state updates
- **Child Workflow Management**: Protect operations that manipulate child workflows
- **Temporal Activities**: Coordinate workflow state before/after activity execution

## Conclusion

The `@Mutex` decorator provides a clean, declarative way to ensure exclusive method execution in workflow code. By preventing concurrent access to critical sections, it helps avoid race conditions, maintain data integrity, and simplify complex concurrent operations. This pattern enhances workflow reliability and correctness, especially in scenarios involving shared state or resource management.
