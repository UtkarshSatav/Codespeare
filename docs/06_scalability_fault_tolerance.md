# Q6 — Scalability and Fault Tolerance

CodeSphere is expected to absorb **millions of code-execution requests per
day** with sharp bursts during contests. This document explains the strategies
that allow the system to scale, stay available, and recover from failure
without losing work.

---

## 6.1 Horizontal Scaling

Every long-running component is **stateless** and **independently scalable**:

| Component             | Scaling unit               | Bottleneck monitored             |
|-----------------------|----------------------------|----------------------------------|
| API Gateway / web     | Pod replicas behind ALB    | CPU, p95 latency                 |
| Submission Service    | Pod replicas               | Queue publish rate               |
| Sandbox Workers       | Pods per language pool     | Kafka consumer lag               |
| Result Service        | Pod replicas               | `verdict.events` consumer lag    |
| WebSocket Hub         | Pod replicas (sticky LB)   | Open connection count            |
| Postgres              | Primary + read replicas    | TPS, replica lag                 |
| Redis                 | Cluster (sharded by key)   | Memory, op/s                     |
| Kafka                 | Brokers + topic partitions | Per-partition throughput         |

### Kubernetes HPA Configuration (sketch)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: worker-python }
spec:
  scaleTargetRef: { kind: Deployment, name: worker-python }
  minReplicas: 10
  maxReplicas: 1000
  metrics:
    - type: External
      external:
        metric: { name: kafka_consumergroup_lag, selector: { matchLabels: { topic: submit.python } } }
        target: { type: AverageValue, averageValue: "20" }   # ≤ 20 msg lag per pod
```

When contest load arrives, Kafka lag climbs, HPA scales worker pods up within
~30 s (assuming warm node pool / Karpenter / Cluster Autoscaler).

---

## 6.2 Load Balancing

* **L4/L7 ALB** at the edge — TLS termination, HTTP/2.
* **Sticky cookies for WebSocket** so reconnects land on the same pod.
* **Least-connections** for API pods.
* **Consistent-hash** routing in the queue (Kafka partitions by `submission_id`)
  so the same submission's verdict updates land on the same Result Service
  shard — preserves per-submission ordering.

---

## 6.3 Distributed Execution Workers

```
                 submit.python ─────► [Worker-Py × N]
                 submit.cpp17  ─────► [Worker-Cpp × M]
                 submit.java   ─────► [Worker-Jvm × K]
                 ...
```

* **Partitioned queues** prevent head-of-line blocking — a 30-s C++ compile
  doesn't stall fast Python submissions.
* **Pool right-sizing** — Java pools run fewer, larger pods (JVM warmup
  amortizes); Python pools run many small pods.
* **Worker warm pool** — each pod keeps 8 idle Docker containers ready;
  `docker exec` into them instead of `docker run`, ≈ 30 ms startup.
* **Image caching** — language base images stay on every node via
  DaemonSet pre-pull → no cold-pull on scale-up.

### Capacity Math

| Variable                       | Value       |
|--------------------------------|-------------|
| Peak submissions/sec           | 500         |
| Avg execution wall-time        | 2 s         |
| Concurrency required (Little's law) | ~1000 |
| Per-pod parallel slots         | 4           |
| Min pods at peak               | 250         |
| Headroom factor                | 2×          |
| **HPA max replicas**           | **~500-1000** |

---

## 6.4 Queue Management (Kafka)

* **One topic per language**, 32 partitions each → up to 32 workers/group
  consume in parallel.
* **Replication factor = 3** across availability zones → tolerates a broker
  failure with zero data loss.
* **Retention = 24 h** for `submit.*` (enough to recover from a 1-day
  outage), **7 d** for `verdict.events`.
* **Dead-letter topic** `submit.dlq` — if a worker fails a message 3× it goes
  to DLQ for human inspection (usually a runtime bug we need to fix).
* **Idempotent verdicts** — Result Service uses `submission_id` as the upsert
  key, so duplicate verdict events (from at-least-once delivery) are safe.

### Backpressure & Load Shedding

* If aggregate Kafka lag > N minutes for too long, API Gateway returns
  `503 Service Busy — try again` for **non-paying / anonymous** users while
  paid users continue to succeed.
* Per-user rate limit (Redis token bucket) hard-caps any single user at
  12 submissions/min.

---

## 6.5 Fault Tolerance

Mapping of failure modes to mitigations:

| Failure                                | Detection                  | Recovery                                             |
|----------------------------------------|----------------------------|------------------------------------------------------|
| Worker pod crash mid-execution         | Kubernetes liveness probe  | Pod restarts; Kafka redelivers unacked message       |
| Worker node lost (EC2 spot reclaim)    | K8s node controller        | Pods rescheduled; messages redelivered               |
| Kafka broker lost                      | Replica failover           | Other brokers serve; partitions re-elected leader    |
| Postgres primary lost                  | Patroni/RDS failover       | Promote a sync replica (~30 s downtime)              |
| Redis shard lost                       | Sentinel / cluster bus     | Auto-failover; cache rebuilds from Postgres on miss  |
| S3 region outage                       | Cross-region replication   | Switch to alternate region in DNS                    |
| Bad code crashes the Docker daemon     | Pod liveness probe         | Pod restart cycles daemon                            |
| Worker stuck on infinite loop          | Wall-clock timer           | `SIGKILL`, emit `TLE` verdict                        |
| Submission Service crashes pre-publish | Client retries with idempotency key | Same submission_id reused, no duplicate row |

**Key invariant**: a Kafka message is acked **only after** a verdict row is
written. Therefore any crash before that point re-runs the submission; we
never silently drop a user's code.

---

## 6.6 High Availability

* **Multi-AZ deployment** — every tier spans ≥ 3 availability zones.
* **Active-active multi-region** for stateless tiers (API, workers); active-
  passive for Postgres (logical replication to a standby region).
* **Anti-affinity rules** so workers, brokers, and DB replicas never share a
  physical node.
* **Pod disruption budgets** ensure rolling deploys don't take more than 25 %
  of any pool offline simultaneously.
* **Blue/green** deploys for the executor image — a new sandbox image runs in
  parallel against a 1 % traffic mirror; only promoted if its verdict
  distribution matches the existing one (catches checker/regress bugs).

Target: 99.95 % monthly availability (≈ 21 min downtime/month).

---

## 6.7 Resource Isolation

Two layers:

### Process-level (per execution)

* cgroups → cpu, memory, pids
* `ulimit` → nofile, fsize, nproc
* network namespace with no interfaces
* read-only root filesystem
* seccomp filter blocking dangerous syscalls
  (`ptrace`, `mount`, `unshare`, `keyctl`, `bpf`, `userfaultfd`, …)

### Tenant-level (per pool)

* **Dedicated node groups** for the strong-isolation tier
  (gVisor / Firecracker) so a sandbox-escape blast radius is bounded to one
  pool.
* **Network policies** restrict every worker pod to only reach Kafka, S3,
  and Postgres — never the internet.
* **PSP / Pod Security Standards** restrict containers from running
  privileged or with host-namespace access.

---

## 6.8 Performance Optimisation

| Technique                         | Impact                                       |
|-----------------------------------|----------------------------------------------|
| Warm Docker pool                  | Cold start ~400 ms → ~30 ms                  |
| Pre-pulled language images        | Avoids 5-10 s image pull on scale-up         |
| Static-linked C++ binaries        | Skip dynamic linker startup                  |
| JVM AOT (GraalVM native-image) for Java judge | Sub-second JVM startup            |
| Per-problem test cases cached in worker disk | Skip S3 fetch on repeats          |
| Compile-output cache keyed on code-hash | Same code → reuse `.o` / `.class`     |
| HTTP/2 + keep-alive between services | Saves connection setup latency           |
| Postgres prepared statements      | Re-uses query plans                          |
| Redis pipelining for leaderboard updates | One RTT for many ZINCRBYs             |
| Read replicas for problem catalogue & history | Offloads primary             |
| Batch verdict commits             | Fewer fsyncs, higher write throughput        |

---

## 6.9 Observability (so you can detect problems before users do)

* **Metrics**: Prometheus + Grafana. SLO dashboards per language pool
  (P50/P95 latency, queue lag, verdict mix, error rate).
* **Tracing**: OpenTelemetry from API Gateway → queue → worker → DB. One
  click goes from a user-visible slow submission to its exact span tree.
* **Logging**: structured JSON to Loki; every line tagged with
  `submission_id`, `user_id`, `pod`.
* **Alerts**:
  * Kafka lag > 60 s for 5 min → page
  * Worker error rate > 1 % → page
  * Postgres replication lag > 30 s → warn
  * `SE` (system error) verdict rate > 0.01 % → page (it should be ~zero)

---

## 6.10 Summary — Why This System Scales

CodeSphere scales because we have:

1. **Decoupled** the synchronous user request from execution via a durable
   queue, so worker latency cannot back-pressure into the API.
2. **Stateless workers** that can be scaled, rescheduled, or killed without
   data loss.
3. **Partitioned queues per language**, eliminating head-of-line blocking
   and allowing pool-level right-sizing.
4. **Polyglot storage** so each data shape uses the cheapest, fastest
   technology for its access pattern.
5. **Multiple isolation layers** ensuring that one bad submission can never
   degrade more than its own container.
6. **Strong SLOs + observability**, so capacity decisions and incident
   response are data-driven, not guesswork.

This combination is what lets a system serve millions of untrusted code
executions per day without losing a single user's submission and without
allowing one submission to harm another.
