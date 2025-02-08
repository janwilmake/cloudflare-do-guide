# A Concise Guide to Durable Objects

Cloudflare Durable Objects are a serverless primitive that allow you to write stateful code on top of the Workers platform. Each Durable Object instance has its own unique identity, in-memory state, and durable storage. They scale automatically and run as single-threaded actors with built‑in coordination, making them ideal for real‑time applications, coordination tasks, caching, and more.

Below are the main features of Durable Objects along with code examples.

---

---

## 1. Global Uniqueness & Actor Model

Every Durable Object is uniquely identified by a **DurableObjectId** derived from a name or generated randomly. This ensures that all requests for the same ID are routed to the same object instance (i.e. the same actor). Because each object runs on a single thread, you avoid many of the concurrency issues common in distributed systems.

> **Example (obtaining an ID and stub):**
>
> ```js
> // In a Worker, get an ID from a name and obtain a stub to send messages:
> const id = env.MY_DO_NAMESPACE.idFromName("room-A");
> const doStub = env.MY_DO_NAMESPACE.get(id);
> // Now you can invoke methods on the Durable Object via RPC:
> const result = await doStub.sayHello();
> ```

---

## 2. In-Memory State

Durable Objects maintain in‑memory state across requests. This state is kept while the object is active, but if the object is idle for long enough it may be evicted (hibernated) and later re‑initialized.

> **Example:**
>
> ```js
> export class Counter extends DurableObject {
>   constructor(state, env) {
>     super(state, env);
>     // Initialize in‑memory state. This value resets if the object is evicted.
>     this.count = 0;
>   }
>
>   async increment() {
>     this.count++;
>     return this.count;
>   }
> }
> ```

---

## 3. Durable Storage API

Each Durable Object has private storage. There are two main storage interfaces:

- **Key‑Value (KV) API:** For simple get/put/delete operations.
- **SQL API (SQLite‑backed, in beta):** For structured queries with transactions.

> **KV Example:**
>
> ```js
> export class Note extends DurableObject {
>   async saveText(text) {
>     await this.state.storage.put("text", text);
>     return text;
>   }
>
>   async getText() {
>     return (await this.state.storage.get("text")) || "";
>   }
> }
> ```
>
> **SQL Example (SQLite backend):**
>
> ```ts
> export class MySQLObject extends DurableObject {
>   sql = this.state.storage.sql;
>
>   async sayHello(): Promise<string> {
>     // Executes a SQL query synchronously (writes are auto‑coalesced)
>     const result = this.sql.exec("SELECT 'Hello, World!' as greeting").one();
>     return result.greeting;
>   }
> }
> ```
>
> **Note:** When using SQLite in Durable Objects, you must opt‑in via your migration (see below).

---

## 4. Alarms API

Durable Objects can schedule future work using the **Alarms API**. An alarm wakes up an object (or keeps it alive) so that periodic or delayed work can be performed.

> **Example:**
>
> ```js
> export class BatchProcessor extends DurableObject {
>   async fetch(request) {
>     // On first request, schedule an alarm 10 seconds from now.
>     if (!(await this.state.storage.getAlarm())) {
>       this.state.storage.setAlarm(Date.now() + 10 * 1000);
>     }
>     // Accept work (for example, queue a job)
>     return new Response("Queued");
>   }
>
>   // Called when the alarm fires:
>   async alarm() {
>     // Process the queued jobs...
>     console.log("Alarm fired: processing queued jobs.");
>   }
> }
> ```

---

## 5. WebSockets & Hibernation

Durable Objects support real‑time communication via WebSockets. There are two modes:

- **Standard WebSockets:** The object stays in memory for the life of the connection.
- **WebSocket Hibernation:** The connection remains open while the object can be hibernated (evicted from memory), reducing costs during inactivity.

> **Standard WebSocket Example:**
>
> ```js
> export class ChatRoom extends DurableObject {
>   // In-memory list of open WebSocket connections:
>   connections = new Set();
>
>   async fetch(request) {
>     const [client, server] = Object.values(new WebSocketPair());
>     server.accept();
>     this.connections.add(server);
>
>     server.addEventListener("close", () => {
>       this.connections.delete(server);
>     });
>
>     return new Response(null, { status: 101, webSocket: client });
>   }
>
>   // Broadcast message to all connections:
>   broadcast(message) {
>     for (const ws of this.connections) {
>       ws.send(message);
>     }
>   }
> }
> ```
>
> **Hibernation Example:**
>
> ```js
> export class HibernatingChat extends DurableObject {
>   async fetch(request) {
>     const [client, server] = Object.values(new WebSocketPair());
>     // Instead of server.accept(), call:
>     this.state.acceptWebSocket(server);
>     return new Response(null, { status: 101, webSocket: client });
>   }
>
>   // Use standard handler methods for WebSocket events:
>   async webSocketMessage(ws, message) {
>     ws.send(`Echo: ${message}`);
>   }
> }
> ```
>
> **Note:** The hibernation API allows Cloudflare to “pin” WebSocket connections without keeping the entire object in memory.

---

## 6. RPC (Remote Procedure Call)

Public methods defined on a Durable Object class are exposed as RPC methods that can be called by a Worker. This makes it possible to invoke object methods as if they were local functions.

> **Example:**
>
> ```ts
> // Durable Object class with an RPC method:
> export class Greeter extends DurableObject {
>   async sayHello(name: string): Promise<string> {
>     return `Hello, ${name}!`;
>   }
> }
>
> // In a Worker:
> const id = env.GREETER.idFromName("alice");
> const stub = env.GREETER.get(id);
> const greeting = await stub.sayHello("Alice");
> console.log(greeting); // "Hello, Alice!"
> ```

---

## 7. Migrations

When you create, rename, or delete a Durable Object class, you must tell Cloudflare’s Workers runtime how to handle persistent state via a migration. (Updating code does not require a migration.)

> **New Class Migration (KV or SQLite):**
>
> ```toml
> [[migrations]]
> tag = "v1"
> new_sqlite_classes = ["MyDurableObject"]   # or new_classes for KV backend
> ```
>
> **Rename or Delete:** You can later add directives (e.g., `renamed_classes` or `deleted_classes`) to migrate state.

---

## 8. Data Location & Location Hints

You can restrict where Durable Objects run by specifying a jurisdiction (for compliance) or by providing a location hint (to reduce latency).

> **Jurisdiction Example:**
>
> ```js
> // Create an ID that is restricted to the European Union:
> const euId = env.MY_DO_NAMESPACE.newUniqueId({ jurisdiction: "eu" });
> ```
>
> **Location Hint Example:**
>
> ```js
> // Hint that the object should run in Eastern North America:
> const stub = env.MY_DO_NAMESPACE.get(id, { locationHint: "enam" });
> ```

---

## 9. Putting It All Together

A sample Worker that routes HTTP requests to a Durable Object might look like this:

> **Full Worker Example (TypeScript):**
>
> ```ts
> // In your Worker:
> export default {
>   async fetch(request, env, ctx): Promise<Response> {
>     const url = new URL(request.url);
>     // Use the URL path (or query) as a Durable Object name:
>     const id = env.MY_DO_NAMESPACE.idFromName(url.pathname);
>     const stub = env.MY_DO_NAMESPACE.get(id);
>
>     // Dispatch based on method and path:
>     if (
>       url.pathname.startsWith("/ws") &&
>       request.headers.get("Upgrade") === "websocket"
>     ) {
>       // WebSocket connection handled by the Durable Object
>       return stub.fetch(request);
>     } else {
>       // Invoke an RPC method, e.g., sayHello
>       const greeting = await stub.sayHello("World");
>       return new Response(greeting, { status: 200 });
>     }
>   },
> } satisfies ExportedHandler<Env>;
> ```
>
> And the Durable Object class might be:
>
> ```ts
> export class MyDurableObject extends DurableObject {
>   // In-memory state
>   stateValue = 0;
>
>   constructor(state: DurableObjectState, env: Env) {
>     super(state, env);
>     // Optionally initialize persistent storage or in-memory values here.
>   }
>
>   async sayHello(name: string): Promise<string> {
>     // Update in-memory state
>     this.stateValue++;
>     // Use Storage API (KV or SQL) if needed:
>     // await this.state.storage.put("counter", this.stateValue);
>     return `Hello, ${name}! Count: ${this.stateValue}`;
>   }
>
>   async fetch(request: Request): Promise<Response> {
>     // If this is a WebSocket request, use the hibernation API:
>     if (request.headers.get("Upgrade") === "websocket") {
>       const [client, server] = Object.values(new WebSocketPair());
>       this.state.acceptWebSocket(server);
>       return new Response(null, { status: 101, webSocket: client });
>     }
>     // Otherwise, default RPC behavior:
>     return new Response("Default Durable Object response", { status: 200 });
>   }
>
>   // Optionally add handlers for WebSocket events:
>   async webSocketMessage(ws: WebSocket, message: string) {
>     ws.send(`Echo: ${message}`);
>   }
> }
> ```
>
> In your Wrangler configuration (`wrangler.toml`), set up the binding and migration:
>
> ```toml
> [[durable_objects.bindings]]
> name = "MY_DO_NAMESPACE"
> class_name = "MyDurableObject"
>
> [[migrations]]
> tag = "v1"
> new_sqlite_classes = ["MyDurableObject"]  # or use new_classes for KV backend
> ```

---

## Summary

Durable Objects give you a unified way to write stateful, globally unique, and scalable code on Cloudflare’s serverless platform. Their main features include:

- **In-Memory State:** Fast, single‑threaded actors that hold state.
- **Durable Storage:** Access via a KV or SQL API.
- **Alarms API:** Schedule future work.
- **WebSocket Support:** Real‑time messaging with standard or hibernating connections.
- **RPC:** Easily invoke methods from a Worker.
- **Migrations:** Manage class creation, renaming, or deletion.
- **Data Location Controls:** Restrict objects to a jurisdiction or hint preferred regions.

By combining these features, you can build applications such as chat systems, real‑time games, collaborative tools, queues, and more—all without managing your own infrastructure.

Happy coding!
