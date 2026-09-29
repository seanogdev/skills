---
name: code-deep
description: Hunt for performance wins in one area of a codebase, for lower latency, less memory, higher throughput, faster load or startup, or better perceived speed. Use when the user says "find optimizations in X", "why is this slow", "make this faster", "speed up load time", "cut memory use", "this doesn't scale", "do a perf pass", or points at a hot path, slow screen, slow endpoint, slow query, or slow job. Not for readability refactors, bug hunts, or general code review.
license: MIT
argument-hint: '[path, module or feature] [goal: latency | memory | throughput | load | perceived]'
---

Find where one area of a codebase does more work than it must. Then say what each win is worth, what it costs, and how to prove it.

Keep four facts in mind:

- The largest wins remove work. They do not make the work faster.
- The cost usually hides in an abstraction that looks innocent.
- Memory access and per-item overhead are usually the limit, not arithmetic.
- Slow code often stays slow because nobody measured it. A folk explanation ("it is a big app", "the language is slow") takes the place of a measurement.

Each path in this skill is relative to the directory that holds this file. Expand it to a full path before you use it.

## 1. Set the scope and the goal

`$ARGUMENTS` holds what the user typed after the skill name. It can name an area, a goal, or both.

Find the area: a path, a module, an endpoint, a screen, a job. If the user gave none, ask. Do not sweep the whole codebase.

Find the goal. Each goal has its own metric:

| Goal       | Metric                                                   | Also watch                           |
| ---------- | -------------------------------------------------------- | ------------------------------------ |
| Latency    | Time for one operation, at p50 and p99                   | The tail, not the mean               |
| Throughput | Items per second at saturation                           | CPU use, and cores that stay idle    |
| Memory     | Bytes per item × item count, peak RSS, allocation count  | GC pauses, fragmentation             |
| Load       | Time from start to first useful output, cold and warm    | Work done at start that can wait     |
| Perceived  | Time until the user can act, and input-to-feedback delay | Anything that blocks the main action |

If the user gave no goal, infer it from the code. A request handler means latency. A batch job means throughput. A cache or a long-lived process means memory. A CLI or app start means load. A UI means perceived speed. Tell the user which goal you chose.

The goals trade against each other. Batching raises throughput and delays each item. A cache cuts latency and costs memory. A busy loop cuts latency and burns a core. For each change, say which goal it serves and what it costs the others.

## 2. Model the workload

Learn the shape of the work before you look for problems:

- **Size.** How many items, how large, and how the count grows. Use real data, not the test fixture. A user with 44,000 files, a 10 MB catalog, or 250 billion cache entries is the real case.
- **Distribution.** Which case is 90% of the traffic. Which case is rare but large.
- **Repetition.** Do inputs repeat? If yes, a cache can pay. If 94% are unique, a cache is waste.
- **Frequency.** Does the code run once at start, or per request, per item, per keystroke, per frame?
- **Location.** Is the data in memory, on disk, over the network, or in another process?

Multiply the per-item cost by the count. One byte per entry × 250 billion entries is 250 GB. A 1 µs syscall × 1 million requests per second is a full core. An overhead that is "too small to matter" often dominates at scale. The reverse is also true: do not tune a path that runs 10 times a day.

## 3. Know how fast it should be

Estimate a floor before you trust the current number. Use one of these:

- **Rough costs.** L1 read ~1 ns. RAM read ~100 ns. Syscall ~0.1–1 µs. Context switch a few µs. SSD read ~20–100 µs. Round trip in one data center ~0.5 ms. Round trip across a continent ~50–150 ms. Memory bandwidth ~10–50 GB/s. SSD read ~1–7 GB/s.
- **A naive reference.** `cat file > /dev/null` for read speed. `dir /s` or `find` for a directory walk. A simple loop over the same data. The same operation in another tool.
- **A comparable case.** The same operation on similar hardware, or a sibling feature in the same app that is fast.

If the code is 10× or more off the floor, a hidden cost exists. Find it. If the code is near the floor, say so and stop. More cleverness gives nothing at the hardware limit.

## 4. Sweep for signals

Read the area with `references/signals.md` open. Go through each hot path in this order. Stop early on a path when a large win shows:

1. Work that does not need to happen.
2. Hidden cost in abstractions, and algorithmic cost.
3. Per-item fixed cost.
4. Memory and data layout.
5. Allocation, GC, and runtime behavior.
6. Concurrency and contention.
7. I/O, syscalls, and network.
8. CPU and hardware detail.
9. Startup and load time, if the goal is load.
10. Perceived speed, if the goal is perceived.

Follow calls down into libraries, the framework, and the runtime. When a library call is on a hot path, read its source or its docs, and write down what it really costs. `sscanf` calls `strlen` on the whole buffer. An `Arc` clone writes to shared memory. A file query can be a cross-process call for each file.

Look above the code too. Sometimes the requirement itself is the cost. Agents that skip collision checks, or a search with a fixed budget, can beat all micro-tuning. Put requirement changes in their own list, because the owner must decide them.

For a large area, split the sweep. Give each subagent one sub-module or one group of signal categories. Each subagent returns candidate findings with `file:line`, the mechanism, and the evidence.

## 5. Confirm

A signal is a hypothesis. Confirm the large ones before you report them as fact. Use `references/measurement.md`.

Start with the cheapest check that can prove you wrong:

1. Trace the path from end to end. Count the calls, the allocations, and the round trips for one realistic input.
2. Check that the N you assumed is real.
3. If you can run the code, measure. Use a realistic, worst-case input, and change one thing at a time.

Give each finding a confidence level:

- **Measured.** You ran it, and the numbers show the cost.
- **Traced.** You read the full path and counted the work. You did not run it.
- **Suspected.** The pattern matches. You did not trace or run it.

Do not change code unless the user asked for fixes. If they did, change one thing at a time and measure each change alone. Keep the old path as the correctness oracle. The output must not change.

## 6. Report

Rank findings by expected gain × confidence ÷ cost. For each finding, give:

- **Where.** `file:line`.
- **What.** The extra work, in one sentence.
- **Why it costs.** The mechanism, with the real N.
- **Gain.** An estimate, and the goal it serves.
- **Fix.** The move, plus a cheaper alternative if one exists.
- **Cost.** Complexity, memory, compatibility, correctness risk, and where the win stops applying.
- **Evidence.** Measured, Traced, or Suspected, plus the step that would confirm it.

Then give:

- **Requirement changes.** Wins that need a product or design decision.
- **Checked and fine.** One line for each hot path you checked that has no problem, so the user knows the sweep covered it.

Leave out micro-optimizations that the compiler or runtime already does, such as shifts for powers of two. Leave out wins on paths that do not run often enough to matter.

## Rules of thumb

- There is no code faster than no code.
- Test the folk explanation before you accept it.
- If a speedup is larger than your model predicts, explain it. The baseline can be the thing that changed.
- After each fix the bottleneck moves, often to a different kind of cost.
- Fix the algorithm first, tune second, and rewrite in another language last. A rewrite often hides algorithmic gains the old language could have had.
- Performance that depends on an optimizer heuristic is fragile. Prefer a construct that guarantees the result.
- Every win has a cost. Write down where it stops applying.
