# Measurement

Use this file to confirm a signal, and to check a claimed speedup.

## Triage before you profile

Watch the resource meters during the slow operation. The shape tells you the class of problem:

- **One core at 100%, no disk or network activity.** A CPU bug in one thread. It is not "loading".
- **All cores idle, and the operation is still slow.** Waiting: a lock, a network call, a sleep, a slow disk, another process.
- **Some cores idle under load.** Too few workers, or contention that serializes them.
- **Spikes on a regular period.** Background runtime work, such as a GC or a timer.
- **Throughput flat as threads increase.** Contention on shared memory or a lock.

Classify the bottleneck before you pick a technique. CPU-bound, memory-bound, I/O-bound, and waiting each need different fixes. A fix for the wrong class does nothing.

## Pick the tool by the question

| Question                        | Tools                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does CPU time go?         | A sampling profiler and a flame graph: `perf`, `py-spy`, `pprof`, `cargo flamegraph`, Instruments, Chrome DevTools, async-profiler                 |
| Why is the CPU stalling?        | Hardware counters: `perf stat` (IPC, branch misses, cache misses), `cachegrind`. Same instruction count at lower IPC means stalls, not extra work. |
| Where does the waiting happen?  | Off-CPU tools: eBPF (`offcputime`, `runqlat`), `strace -c`, ETW/WPA on Windows                                                                     |
| Is the cost in another process? | A system-wide trace. The cost can be in a broker, a service, or the kernel.                                                                        |
| Where does memory go?           | A heap profiler, allocation counts per item, the real `sizeof` of each struct                                                                      |
| Does it scale?                  | Throughput vs thread count, on the target hardware                                                                                                 |
| Is it O(n²)?                    | Time per operation across a whole run. A rising line means cost grows with size.                                                                   |
| Which cache level limits it?    | A sweep of input size from KB to GB. Steps in the curve show L1, L2, L3, and RAM.                                                                  |
| What does the machine run?      | The disassembly, the JIT's optimized code, VM builtin names in the profile                                                                         |

## Build a benchmark you can trust

- **Use real, worst-case input.** A real edit trace, a real large file, an edit at the start of the file, a real user's data folder. Synthetic averages hide the problem.
- **Control the machine.** Pin the CPU frequency. Run several times. Report the median and the spread.
- **Separate cold from warm.** Caches hide bugs.
- **Separate latency from throughput.** Independent queries measure throughput. A dependent chain measures latency.
- **Measure CPU time as well as wall time.** A spin lock looks fast on wall time and burns cores.
- **Report tails, not only means.** p99 and max.
- **Keep a holdout set.** A benchmark suite becomes a target, and code overfits to it. Check on real inputs the tuning never saw.
- **Change one thing at a time.** Measure each change alone and together. With one change per commit you can bisect the gains later.
- **Check that the measurement tool is not the bottleneck.** A pipe viewer or a logger can cap the number you see.
- **Check that the compiler did not delete or restructure the benchmark.**
- **Test on the target hardware.** A laptop hides contention that a 2-socket server shows. A trick that wins on one CPU and bus can lose on another.

## Distrust these

- **The folk explanation.** "It is a big app." "This algorithm is slow." "The other one is fast because of its language." Test each with a controlled comparison.
- **A speedup larger than your model predicts.** Check the baseline first. A compiler regression in the old build can make a small gain look large.
- **An unfair comparison.** The new version has algorithmic fixes the old one lacks. One side is durable and the other is not. Compare like with like.
- **A tuning list copied from elsewhere.** Apply each item alone and measure it.
- **A microbenchmark of the pathological case.** It can reward behavior that hurts real use, such as an unfair lock.

## When the profiler shows nothing

- Contended atomics look like slow ordinary instructions spread across the profile. Suspect contention when scaling is flat.
- The cost can be in another process. Trace the whole system.
- Bisect by removal. Delete layers until the smallest reproduction still shows the problem.
- Look at the data, not only the code. Dump the input the slow path gets.

## When to stop

- The code is at the hardware ceiling: memory bandwidth, disk speed, line-fill buffers.
- The added complexity costs more than the gain.
- The next bottleneck is outside the area you were asked to look at. Report it and stop.
