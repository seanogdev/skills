# Signals

Each entry shows what you see in the code, why it costs, and the move.

## 1. Work that does not need to happen

Look here first. This category holds the largest wins.

- **Recompute when the input did not change.** A status bar redraws a value that is the same. A whole document reparses on each keystroke. A whole list rebuilds after one item changes. → Skip unchanged output. Make the cost scale with the size of the change, not the size of the whole.
- **A check that an invariant already guarantees.** A dedupe runs on input that is unique, into a container that starts empty. → Remove the check. First prove the invariant.
- **A scan of data the feature does not use.** A recorder scans all of Documents to list files in one folder. → Limit the query to the location and the types the feature needs.
- **A result that nobody reads.** Flags are computed and then overwritten. A whole document is parsed when the caller reads two fields. → Remove dead computation. Parse lazily.
- **Fetch the whole object to get a small part.** → Ask for the cheapest source first: a metadata endpoint, a range request for an index at the end of an archive, a projection.
- **A copy between layers.** Data goes from user space to a kernel buffer and back. Each environment gets its own copy of the same files. Wire bytes are parsed only to be serialized again. → Move references, not bytes (splice, hardlinks, copy-on-write). Keep the wire format as the storage format.
- **A cache that costs more than it saves.** The hash plus the lookup costs more than computing the value again. The inputs never repeat. → Measure the cache against recomputation. Delete it if it loses.
- **Invariant work inside a loop.** → Hoist it out. Sometimes the loop disappears.
- **Legacy or compatibility paths on the hot path.** Fallbacks for old formats, permissive parsing, a subprocess to read config. → Put them behind a flag or a slow path. Or drop them if the owner agrees.
- **Unbounded search.** → Put a hard budget on depth or iterations. Make the result at the budget acceptable.
- **Expensive realism that the user cannot see.** Per-pair collision checks, exact routing for agents with no goal. → Propose a cheaper behavior that feels the same. This is a requirement change, so list it apart.
- **An old runtime, kernel, compiler, or library.** → Check whether an upgrade already fixes it before you hand-tune. Test the upgrade, because some regress.

## 2. Hidden cost in abstractions, and algorithmic cost

- **A library call whose cost scales with the whole input, inside a loop.** `sscanf` or `strtok` on a large buffer, string concatenation in a loop, `list.contains`, `indexOf`, `in` on a list, `array.shift`, a regex compiled per call, an ORM lazy load per row. → Know the real cost of each call on large input. Read the source when it is on a hot path.
- **A linear search where a key exists.** → Use a hash map or an index.
- **Time per operation grows as the data grows.** This means O(n) per operation, so O(n²) in total. → Plot the time per operation across a whole run to see it. Then store relative values (lengths, not absolute positions). Add subtree counts to tree nodes. Reuse unchanged subtrees.
- **A search always starts from the beginning.** → Remember the last position and start there. Real workloads have locality.
- **A generic sort on data that is already partly ordered.** → Bucket as you parse, then sort small groups. Use insertion sort for tiny arrays.
- **Backtracking with no memory of why it failed.** → Learn from each conflict so later branches skip the same dead end.
- **A reference-count clone on a hot path across threads.** It writes to shared memory even when the code only reads. → Give each thread its own copy.
- **A high-level API that crosses a process or does a lookup for each item.** → Trace the whole system. Compare with a naive tool that does the same I/O.
- **Virtual dispatch in a tight loop over many small objects.** It hides a common formula and blocks inlining and SIMD. → Group code by operation, not by type. Use a switch or a table of coefficients.
- **A distributed system for data that fits on one machine.** → Stream on one machine. Question the architecture before you tune its parts.

## 3. Per-item fixed cost

The signal: many small items, and a fixed cost for each one that is larger than the useful work. Batch or amortize the fixed cost.

- **One syscall per small item.** A `write` per line, an `open` and `close` per blob, an `fsync` per row. → Fill one large buffer. Keep one container open. Put many writes in one transaction.
- **One network round trip per item.** N+1 queries, fetches one after another. → Batch, run in parallel, or pipeline.
- **One object or allocation per record.** → Use a packed typed array or a struct of arrays. Reuse one scratch buffer.
- **A new copy per change in an immutable structure on a hot mutating loop.** → Mutate in place in the hot core.
- **A process or interpreter start per item.** → Stay in-process.
- **A notification or wake-up per item.** → Wake one worker only when no worker is already looking.
- **An interrupt per packet, or a lock per item.** → Coalesce. Take the lock once per batch.

Watch out: a buffer delays the first item. Every batch has a crossover size where the gain stops. For blobs, the filesystem wins again above about 250 KB to 1 MB.

## 4. Memory and data layout

- **Graphs of many small objects linked by pointers.** Linked lists, a tree node per character, boxed values. Each pointer you follow can miss the cache. → Flatten to arrays. Store runs as spans. Pack nodes to cache-line size.
- **A growable container for data that never changes after insert.** It holds a capacity word and slack space. → Use a fixed-size container.
- **A union or enum sized by its rare large case.** → Box the rare case, or store raw bytes in one buffer with a length prefix.
- **Padding.** Booleans spread through a struct. Fields wider than their real range. → Pack flags into bits. Size each field to its range. Measure the real size, because alignment makes hand arithmetic wrong.
- **Data stored that can be derived.** → Store the common case implicitly and rebuild it from context.
- **Sibling collections for the same entry.** → Merge them into one, with small offsets.
- **Hot and cold fields mixed together.** → Put the hot fields first, on the first cache line.
- **One value used per cache line fetched.** Binary search is the classic case. → Use cache-line-sized nodes, or an Eytzinger or B-tree layout.
- **Two structures updated on each operation.** → Keep one. Each extra structure adds its full update cost to every operation.
- **Memory in a cache is capacity.** Bytes saved per entry become a higher hit rate.

Watch out: a packed layout can turn random access into a sequential walk. That is fine only when each walk is short.

## 5. Allocation, GC, and runtime behavior

- **Latency spikes on a regular period.** → Suspect background runtime work: a forced GC, a JIT, compaction, a timer. The period is the clue. Read the runtime source.
- **A large, long-lived, pointer-rich heap under a tracing GC.** The cost scales with the live heap, not with the garbage. → Use pointer-free layouts, off-heap storage, a smaller live set, or deterministic freeing.
- **An allocation per call where a buffer can be reused.** → Reuse it.
- **Objects that all die at the same time.** → Use an arena or a bump allocator.
- **Many objects of the same size.** → Use a pool or size classes.
- **JIT cost-model misses.** A call site with many shapes, an argument count that does not match the parameters, objects in dictionary mode. → Keep hot call sites to one shape. Make a copy of a hot generic function for each caller.
- **The runtime itself is the floor** after years of tuning inside it. → Port to a runtime with layout control and real threads. Keep the architecture, and use the old version as the oracle. This is the last resort.
- **A speedup that relies on an optimizer heuristic.** → Prefer a construct that guarantees the result (`musttail`, explicit SIMD, typed arrays). Check again after each toolchain upgrade.

## 6. Concurrency and contention

- **Throughput does not scale with cores, and the profile is flat.** → Suspect cache-line contention: a shared atomic counter, a reference-count clone, a shared queue head, false sharing. Test on the target hardware, because one laptop socket hides it.
- **Shared mutable state on the hot path.** → Use per-thread or per-core state. Shard it. Give each item one writer. Use work stealing, and steal half a queue at a time. Pass messages. The best lock is no shared state.
- **Spin locks.** They look fine on wall time and burn CPU. → Measure CPU time as well as wall time. Let the OS sleep waiters.
- **Wake all waiters.** → Wake one. Limit how many workers look for work at the same time.
- **A blocking call on an event loop.** A disk `open`, a sync log write, a sync DNS lookup. It stalls every connection on that worker. → Move it off the loop. Use one pool per disk.
- **A second thread pool on top of the first.** → Fit the host's thread model.
- **Lockstep workers on cores of unequal speed.** The slowest core sets the pace. → Keep them on cores of equal speed.
- **Independent work done one item at a time.** Per-file parse, sequential downloads. → Run it in parallel.
- **Idle cores.** → Check use before you micro-tune. A server that uses 2 of 4 cores has an easy 2× left.
- **A task that was just woken.** → Run it next while its data is hot in cache. This costs some fairness.

## 7. I/O, syscalls, and network

- **Small unbuffered writes.** → Buffer them.
- **A full read when only a part is needed.** → Use a range read, an index, or mmap.
- **Serial requests that do not depend on each other.** → Run them in parallel or pipeline them.
- **Extra layers on each packet or syscall.** Audit, seccomp, firewall rules, a raw socket that sees every packet, mitigations. They are invisible at low load and dominant at 1M requests per second. → Remove the ones the deployment does not need. This is a security decision, so say so.
- **Poor locality between queue, IRQ, and thread.** → Pin so that one request stays on one core from the NIC to the reply.
- **Repeated handshakes and repeated compression.** → Cache TLS sessions. Serve pre-compressed static files. Cache open file handles.
- **A hot library with a faster, compatible fork.** → Swap it. For example zlib-ng for zlib. Then confirm in the profile that the fast path runs.
- **Copied sysctl or tuning lists.** → Apply one change at a time and measure it. Old tunings can be harmful on new kernels.

## 8. CPU and hardware detail

Look here last. These wins are real but smaller, and they are the most fragile.

- **An unpredictable data-dependent branch in a hot loop.** → Make it branchless (arithmetic or `cmov`), use a small table, or sort the data if the sort is amortized.
- **A byte-at-a-time loop over long contiguous data with a simple test.** → Use SIMD in five steps: broadcast the constant, loop by vector width, run one operation on all lanes, reduce to a scalar, handle the tail with the scalar loop. First check whether the compiler already vectorizes it. Keep the scalar loop as the fallback and the reference.
- **An irregular parse, byte by byte.** → Split it into a regular pass that finds the structure and a second pass over only those positions.
- **A dependent chain of cache misses.** → Batch independent queries, prefetch the next line, and interleave work so that stalls overlap.
- **An inner kernel that loads the same values again and again.** → Tile in registers. Unroll the outer loop so that each load serves many operations.
- **Generality the callers never use.** Parameters that are always the same value, sizes that always divide evenly. → Specialize for the real calls.
- **Levels of indirection in a hot path.** → Hoist the dereference. Inline hot helpers.
- **Dead code in a hot binary.** → Remove it. Smaller code fits the instruction cache.
- **Build settings.** A debug build, no `-O2` or `-O3`, no target-CPU flags, no LTO or PGO. → Fix the build before you touch the code.

Watch out: branchless code is slower when the branch is predictable. The compiler may already do the transformation. Read the disassembly before and after.

## 9. Startup and load time

- **Work at start that the first screen does not need.** → Defer it until first use, or run it in the background.
- **Work at start that is the same every run.** → Do it once ahead of time and cache the result.
- **Interpreter start, VM warm-up, or JIT warm-up that dominates short runs.** → Use a native or AOT build for that entry point.
- **A waterfall of dependent fetches.** → Start independent fetches at the same time.
- **A large bundle or a deep dependency tree.** → Remove dependencies. Use smaller libraries.
- **Module initialization with side effects.** → Make initialization lazy.
- **Different results cold and warm.** A cache can hide the bug in casual tests. → Measure both.

## 10. Perceived speed

- **The main action waits on secondary work.** A record button waits for a file list. → Unblock the main action. Load the secondary data after it, or in parallel.
- **A UI that looks ready and is not.** → Disable the control or show its state. Do not accept input and then ignore it.
- **Work that starts only when the user confirms.** → Start it early, while the user is still busy. Upload the photo while they write the caption.
- **A round trip before any feedback.** → Update the UI at once and reconcile when the server replies.
- **Heavy work on the main or UI thread.** → Move it to the background in small batches. Model each batch as an edit so that the same incremental path handles it.
- **Input-to-feedback delay above ~100 ms.** → Treat per-keystroke and per-frame work as the tightest budget in the app. Its cost must scale with the edit.
- **Steps the user does not need.** → Remove the step instead of making it faster.
