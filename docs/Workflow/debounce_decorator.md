# `@Debounce` Decorator

## Introduction to the `@Debounce` Decorator

The `@Debounce` decorator in ChronoForge provides a powerful way to control the frequency of method execution in workflow code. It limits how often a method can be called, ensuring that when a method is invoked multiple times in quick succession, only the last invocation actually executes after a specified delay period. This pattern is particularly useful for handling rapid events or signals that might otherwise cause resource contention or unnecessary processing.

## Purpose of the `@Debounce` Decorator

The primary purposes of the `@Debounce` decorator are:

- **Rate Limiting**: Prevent methods from being executed too frequently
- **Last-Call Execution**: Ensure only the most recent invocation is processed
- **Resource Optimization**: Avoid redundant or wasteful operations
- **Signal Handling**: Efficiently manage rapid signals or events

## How the `@Debounce` Decorator Works

The `@Debounce` decorator uses Temporal's `CancellationScope` to implement its functionality:

1. When a debounced method is called, a wait period begins (specified by the `ms` parameter)
2. If the method is called again during this wait period, the previous pending execution is cancelled
3. A new wait period begins for the latest call
4. After the wait period completes without interruption, the method executes
5. The actual method execution happens in a non-cancellable context to ensure it completes

This implementation ensures that:

- Only the most recent call executes
- The method execution itself is protected from cancellation
- Cancellation is properly handled without throwing errors to the caller

## Usage Examples

### Basic Usage

```typescript
import { Workflow, Debounce } from 'chrono-forge';

class NotificationWorkflow extends Workflow {
  private notificationCount = 0;
  
  @Debounce(500) // 500ms debounce time
  protected async sendNotification(userId: string, message: string): Promise<void> {
    // This method will only execute once if called multiple times within 500ms
    this.notificationCount++;
    this.log.info(`Sending notification to ${userId}: ${message} (count: ${this.notificationCount})`);
    
    // Notification logic...
    await this.notificationService.send(userId, message);
  }
}
```

### Handling UI Updates

```typescript
class DashboardWorkflow extends Workflow {
  @Debounce(1000) // 1 second debounce time
  protected async updateDashboard(data: any): Promise<void> {
    // This method will only update the dashboard once per second, regardless of how many
    // times it's called during that period
    this.log.info(`Updating dashboard with latest data`);
    
    // Dashboard update logic...
    await this.dashboardService.update(data);
  }
}
```

### Signal Processing

```typescript
class StateWorkflow extends Workflow {
  private state: any = {};
  
  @Signal('updateState')
  public onUpdateState(newState: Partial<any>): void {
    // Signals might come in rapid succession
    this.state = { ...this.state, ...newState };
    this.procesStateChange();
  }
  
  @Debounce(200)
  private async procesStateChange(): Promise<void> {
    // This ensures we only process state changes at most every 200ms
    this.log.info(`Processing state change`);
    
    // State processing logic...
    await this.stateManager.syncState(this.state);
  }
}
```

## Advanced Usage

### Combining with Other Decorators

The `@Debounce` decorator can be combined with other decorators for more complex behaviors:

```typescript
class SearchWorkflow extends Workflow {
  @Debounce(300)
  @Guard(function(query: string) {
    return query.length >= 3;
  })
  protected async performSearch(query: string): Promise<any[]> {
    // This method will only execute if:
    // 1. The query is at least 3 characters long (Guard)
    // 2. It's the most recent call after a 300ms delay (Debounce)
    this.log.info(`Performing search for: ${query}`);
    
    // Search logic...
    return await this.searchService.search(query);
  }
}
```

### Configuring Different Debounce Times

Different methods may need different debounce times based on their purpose:

```typescript
class AnalyticsWorkflow extends Workflow {
  @Debounce(100) // Short debounce for time-sensitive operations
  protected async trackUserAction(action: string): Promise<void> {
    // Track user actions quickly with minimal debounce
    await this.analyticsService.track(action);
  }
  
  @Debounce(5000) // Long debounce for expensive operations
  protected async generateReport(): Promise<void> {
    // Only generate reports at most every 5 seconds
    await this.reportingService.generate();
  }
}
```

## Temporal Integration

The `@Debounce` decorator is specifically designed to work within Temporal workflows and takes advantage of Temporal's concurrency primitives:

- It uses `CancellationScope` to manage the cancellation of pending executions
- It ensures that the method execution itself is wrapped in a `nonCancellable` scope
- It properly handles cancellation exceptions to prevent errors from propagating

## Best Practices

### 1. Choose Appropriate Debounce Times

Select a debounce time that balances responsiveness with efficiency. Too short might not provide much benefit, while too long could make the application feel unresponsive.

### 2. Use for Non-Critical Delayed Processing

Debouncing is most appropriate for operations where:

- Only the most recent call matters
- There's no need to process every single invocation
- A slight delay is acceptable

### 3. Consider Method Side Effects

Be careful with debouncing methods that have side effects that should happen for every call. Since only the last call executes, intermediate calls won't produce their side effects.

### 4. Be Mindful of Method Arguments

When a debounced method is called multiple times with different arguments, only the arguments from the last call will be used. Design your code accordingly.

### 5. Combine with Other Patterns When Needed

For more complex behaviors, consider combining `@Debounce` with other decorators like `@Guard`, `@Mutex`, or `@On`.

## Conclusion

The `@Debounce` decorator provides an elegant way to control method execution frequency in Temporal workflows, helping optimize resource usage and prevent redundant operations. By ensuring only the most recent call executes after a specified delay, it's particularly useful for handling rapid events, signals, or changes that don't each require individual processing. This pattern enhances workflow efficiency and responsiveness, especially in scenarios with potential bursts of activity.
