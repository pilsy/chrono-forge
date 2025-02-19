# Temporal-Forge

### (A Next-Gen Temporal Workflow Orchestration Framework for TypeScript)

 [![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-♥-ff69b4)](https://github.com/sponsors/pilsy)   [![Test Suite](https://github.com/pilsy/chrono-forge/actions/workflows/run-tests.yml/badge.svg)](https://github.com/pilsy/chrono-forge/actions/workflows/run-tests.yml)   [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pilsy_chrono-forge&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pilsy_chrono-forge)   [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=pilsy_chrono-forge&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=pilsy_chrono-forge)   [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=pilsy_chrono-forge&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=pilsy_chrono-forge)   [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=pilsy_chrono-forge&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=pilsy_chrono-forge)  

Temporal-Forge **supercharges** Temporal.io workflows by **eliminating boilerplate, automating state management, and enabling seamless hierarchical orchestration.**  

- **Decorator-Based API** → Write workflows in a **declarative, intuitive** way  
- **Event-Driven Updates** → **No polling**—Workflows **automatically synchronize state**  
- **State Normalization & Hierarchical Management** → Built-in **entity normalization & child workflow orchestration**  
- **ContinueAsNew & Long-Running Workflow Support** → **Efficiently persists state** and **prevents history bloat**  
- **API Integration** → Load & sync external data in **real-time**  
- **Built-in Observability** → OpenTelemetry support for **tracing and debugging**  

---

## **💡 Why Use Temporal-Forge?**

- **🚀 Faster Workflow Development** → No need to manually manage signals, queries, or updates.  
- **🧠 Intelligent State Management** → Normalized entities with **automatic denormalization** and caching.  
- **🎯 Precision Updates** → Changes **only propagate where needed**, eliminating redundant state syncing.  
- **🤖 Automatic Child Workflow Handling** → Start, stop, and update workflows **without writing extra logic**.  

---

## **📌 Key Features**

### **1️⃣ Step-Based Workflow Execution**

**Temporal-Forge simplifies workflow design** using decorators like `@Step()`, `@Query()`, and `@Signal()` to define workflow logic.  

- **Step-based execution with dependencies**  
- **Conditional branching & dynamic workflow control**  
- **Lifecycle hooks (`@Before()`, `@After()`, `@Hook()`)**  

---

### **2️⃣ Advanced Stateful Workflow Management**

**Stateful workflows handle complex entity relationships with automatic state tracking.**  
✔ **Automatic child workflow execution & cancellation**  
✔ **Parent workflows automatically sync child state changes**  
✔ **Limitless nesting of parent-child workflows**  

---

### **3️⃣ Event-Driven, Subscription-Based Updates (No Polling)**

- **Entities update automatically across workflows**
- **Only relevant workflows receive updates** via event-driven **signals**
- **Ancestor tracking prevents infinite loops & redundant updates**  

💡 **How it Works?** → Each workflow **subscribes to only the data it cares about.**  
If an entity updates, **only dependent workflows receive updates**, ensuring **low-latency state propagation**.  

---

### **4️⃣ Normalized State & Cached Denormalization**

State is structured using `normalizr`, ensuring **efficient, normalized entity management**.  
✔ **Automatically flattens nested relationships**  
✔ **StateManager & limitRecursion cache queries to optimize lookups**  
✔ **Denormalization is fully cached & optimized**  

---

### **5️⃣ Auto-Managed Child Workflow Lifecycle**

- ✅ **Starts child workflows when needed**  
- ✅ **Cancels workflows when dependencies change**  
- ✅ **Passes subscription objects so child workflows notify parents of updates**  

No more **manual child workflow management**—it just works.  

---

## **📦 Installation**

```bash
npm install temporal-forge
```

or  

```bash
yarn add temporal-forge
```

**🔧 Requirements:**  

- Node.js 20+  
- Temporal.io’s TypeScript SDK 1.11.7+

---

## **🚀 Quick Start**

### **Basic Workflow**

```typescript
import { Temporal, Workflow } from 'temporal-forge';

@Temporal()
class SimpleWorkflow extends Workflow {
  async execute() {
    this.log.info('Executing workflow...');
  }
}

export default SimpleWorkflow;
```

### **Stateful Workflow Example**

```typescript
// Your types
type User = {
  id: string;
  likes: Like[];
};

type Like = {
  id: string;
  user: User;
};
```

```typescript
import { Temporal, StatefulWorkflow, SchemaManagerStatefulWorkflowParams, StatefulWorkflowOptions } from 'temporal-forge';

@Temporal({
  schemaName: "User",
  schemas: SchemaManager.schemas
})
class UserWorkflow extends StatefulWorkflow<
  StatefulWorkflowParams<User>,
  StatefulWorkflowOptions
> {
  @Property({ path: 'likes' })
  protected likes!: Like[];

  async execute() {
    this.log.info('Executing workflow, all children in this.likes will have been auto started...');
  }
}

export default UserWorkflow;
```

```typescript
// Set your schemas (usually done in src/schemas.ts)
SchemaManager.parseYAML(`
  User:
    idAttribute: id
    likes: [Like]
  Like:
    idAttribute: id
    user: User
`);
```

💡 **This workflow automatically normalizes state and updates subscribers whenever data is changed!**

---

## **📖 Documentation**

📚 **Read the full docs:**  

- **[StatefulWorkflow Documentation](docs/StatefulWorkflow.md)**
- **[Workflow Documentation](docs/Workflow.md)**
- **[Entity State Management](docs/entities.md)**

---

## **🛠️ Core Concepts**

✔ **Step-Based Execution** → Define steps using `@Step()`  
✔ **Workflow Lifecycle Management** → Manage workflow execution state  
✔ **Query & Signal Handling** → Real-time data retrieval and updates  
✔ **Automatic Retry & Error Handling** → Decorators like `@OnError()` simplify failure recovery  

---

## **📌 Advanced Topics**

- **Handling Circular Workflow Relationships** → Prevents redundant updates  
- **Security & API Token Management** → Securely handle external API access  
- **ContinueAsNew Optimization** → Ensures long-running workflows stay within Temporal’s execution limits  

🔍 **Full API reference available in** [docs/API.md](docs/API.md)  

---

## **🧪 Testing & Validation**

Temporal-Forge includes a **comprehensive test suite**:

- ✅ Unit tests for **decorators, subscriptions, and state management**  
- ✅ **Integration tests** covering **real-world workflow scenarios**  
- ✅ SonarCloud reports for **maintainability, security, and reliability**  

💡 **Run tests locally:**  

```bash
npm run test
```

---

## **🤝 Contributing**

🚀 We welcome contributions! Whether it's **bug fixes, feature requests, or documentation improvements**—join the project and help make Temporal-Forge even better.  

📌 **See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.**  

---

## **📜 License**

**MIT License** – See the [LICENSE](./LICENSE) file for more details.

---

### **💡 "Those who say it cannot be done should stop interrupting the people doing it."**  
