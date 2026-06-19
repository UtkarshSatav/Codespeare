# Architecture Diagrams

A collection of ASCII diagrams that together describe CodeSphere from multiple
viewpoints: logical components, request sequence, deployment, and sandbox
defense layers.

---

## A. Logical Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL                                          │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                       │
│   │ Web Browser  │   │ Mobile App   │   │ CLI / API    │                       │
│   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                       │
└──────────┼──────────────────┼──────────────────┼───────────────────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
┌─────────────────────────── EDGE ───────────────────────────────────────────────┐
│   ┌────────────────────────────────────────────────────────────────────────┐   │
│   │              CDN  (CloudFront)  +  Global Load Balancer                │   │
│   └────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬─────────────────────────────────────────────┘
                                   ▼
┌─────────────────────── APPLICATION TIER ───────────────────────────────────────┐
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│   │ API Gateway  │  │ Auth Service │  │Problem Svc.  │  │ WebSocket Hub│       │
│   │  (JWT, RL)   │  └──────────────┘  └──────────────┘  └──────────────┘       │
│   └──────┬───────┘                                            ▲                │
│          ▼                                                    │                │
│   ┌──────────────────┐                ┌──────────────────┐    │                │
│   │ Submission Svc.  │                │  Result Svc.     │────┘                │
│   │ (producer)       │                │  (consumer)      │                     │
│   └──────┬───────────┘                └────────▲─────────┘                     │
└──────────┼──────────────────────────────────────┼──────────────────────────────┘
           ▼                                      │
┌────────────────────────── MESSAGING ────────────┼──────────────────────────────┐
│   ┌────────────────────────────────────┐    ┌───┴────────────────────────┐     │
│   │   Kafka — submit.<language>        │    │  Kafka — verdict.events    │     │
│   │   (per-language partitions)        │    │  (replayable audit log)    │     │
│   └─────────────────┬──────────────────┘    └────────────────────────────┘     │
└─────────────────────┼──────────────────────────────────▲──────────────────────-┘
                      ▼                                  │
┌────────────────── EXECUTION FLEET ──────────────────────┼──────────────────────┐
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐│                      │
│   │ Worker   │  │ Worker   │  │ Worker   │  │ Worker   ││                      │
│   │ Python   │  │ C/C++    │  │ Java     │  │ JS / Go  ││                      │
│   │ (Docker  │  │ (Docker  │  │ (Docker  │  │ (Docker  ││                      │
│   │  +seccomp│  │  +seccomp│  │  +seccomp│  │  +seccomp│┘                      │
│   │  +cgroup)│  │  +cgroup)│  │  +cgroup)│  │  +cgroup)│                       │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                       │
└────────┼─────────────┼─────────────┼─────────────┼─────────────────────────────┘
         └─────────────┴──────┬──────┴─────────────┘
                              ▼
┌──────────────────────────── DATA TIER ─────────────────────────────────────────┐
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│   │ PostgreSQL   │  │ S3           │  │ Redis        │  │ ElasticSearch│       │
│   │ (primary +   │  │ (code blobs, │  │ (cache,      │  │ (problem     │       │
│   │  3 replicas) │  │  outputs)    │  │  leaderboard)│  │  search)     │       │
│   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘       │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## B. Request Sequence Diagram (Submit → Verdict)

```
Client      API GW    Submission Svc    Postgres    Kafka       Worker      Result Svc    WS Hub
  │           │              │             │           │           │              │           │
  │ POST /sub │              │             │           │           │              │           │
  ├──────────►│              │             │           │           │              │           │
  │           │ validate JWT │             │           │           │              │           │
  │           │ rate-limit   │             │           │           │              │           │
  │           ├─────────────►│             │           │           │              │           │
  │           │              │ INSERT QUEUED            │           │              │           │
  │           │              ├────────────►│           │           │              │           │
  │           │              │ S3 PUT code │           │           │              │           │
  │           │              │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►(S3)       │              │           │
  │           │              │ produce submit.python    │           │              │           │
  │           │              ├──────────────────────────►          │              │           │
  │ 202 + id  │              │             │           │           │              │           │
  │◄──────────┤              │             │           │           │              │           │
  │ open WS  │               │             │           │           │              │           │
  ├──────────────────────────────────────────────────────────────────────────────►│           │
  │           │              │             │           │           │              │           │
  │           │              │             │           │ consume   │              │           │
  │           │              │             │           ├──────────►│              │           │
  │           │              │             │           │           │ docker run   │           │
  │           │              │             │           │           │ sandbox      │           │
  │           │              │             │           │           │ (compile +   │           │
  │           │              │             │           │           │  run tests)  │           │
  │           │              │             │           │           │ produce verdict.events    │
  │           │              │             │           │           ├─────────────►│           │
  │           │              │             │           │           │ ack message  │           │
  │           │              │             │           │◄──────────┤              │           │
  │           │              │             │           │           │              │ UPDATE    │
  │           │              │             │◄───────────────────────────────────-─┤ verdict   │
  │           │              │             │           │           │              │           │
  │           │              │             │           │           │              │ push WS   │
  │           │              │             │           │           │              ├──────────►│
  │ verdict   │              │             │           │           │              │           │
  │◄───────────────────────────────────────────────────────────────────────────────────────────│
```

Key property: the **client's HTTP request returns in ~50 ms** with just the
`submission_id`; the verdict arrives asynchronously over WebSocket. Workers
can take as long as they need without blocking the API tier.

---

## C. Deployment Diagram (Kubernetes)

```
┌─────────────────────────  Region A — multi-AZ ───────────────────────────────-─┐
│                                                                                │
│   ┌────────────── AZ-1 ───────────────┐  ┌────────────── AZ-2 ───────────────┐ │
│   │                                   │  │                                   │ │
│   │  Node Pool: api                   │  │  Node Pool: api                   │ │
│   │   ├─ api-gateway × 3              │  │   ├─ api-gateway × 3              │ │
│   │   └─ submission-svc × 3           │  │   └─ submission-svc × 3           │ │
│   │                                   │  │                                   │ │
│   │  Node Pool: workers-py            │  │  Node Pool: workers-py            │ │
│   │   └─ worker-python × N (Docker)   │  │   └─ worker-python × N (Docker)   │ │
│   │                                   │  │                                   │ │
│   │  Node Pool: workers-cpp           │  │  Node Pool: workers-cpp           │ │
│   │   └─ worker-cpp × N               │  │   └─ worker-cpp × N               │ │
│   │                                   │  │                                   │ │
│   │  Node Pool: data                  │  │  Node Pool: data                  │ │
│   │   ├─ kafka-broker (1 of 3)        │  │   ├─ kafka-broker (2 of 3)        │ │
│   │   ├─ redis-shard                  │  │   ├─ redis-shard                  │ │
│   │   └─ postgres-replica             │  │   └─ postgres-replica             │ │
│   └───────────────────────────────────┘  └───────────────────────────────────┘ │
│                                                                                │
│   ┌────────────── AZ-3 ───────────────┐    Managed: S3, CloudFront, Route53    │
│   │  …same shapes…  + postgres-primary│                                        │
│   └───────────────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────────────┘

      ▲ async logical replication
      │
┌─────────────────────────  Region B — standby ─────────────────────────────────-┐
│   postgres-standby, kafka-mirror, cold S3 replica                              │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## D. Sandbox Defense-in-Depth

```
                 ┌──────────────────────────────────────┐
   user code ──► │ Layer 0  — API authn + rate-limit    │
                 ├──────────────────────────────────────┤
                 │ Layer 1  — Docker container          │
                 │   read-only root, tmpfs /tmp,        │
                 │   non-root user, --network none      │
                 ├──────────────────────────────────────┤
                 │ Layer 2  — Linux primitives          │
                 │   cgroups (cpu,mem,pids)             │
                 │   capabilities dropped               │
                 │   seccomp-bpf syscall filter         │
                 │   no-new-privileges                  │
                 ├──────────────────────────────────────┤
                 │ Layer 3  — Wall-clock killer         │
                 │   external timer SIGKILLs after T+ε  │
                 ├──────────────────────────────────────┤
                 │ Layer 4  — (optional) gVisor or      │
                 │   Firecracker microVM for paid /     │
                 │   contest tier                       │
                 ├──────────────────────────────────────┤
                 │ Layer 5  — Audit & detection         │
                 │   ptrace summary, anomalous syscalls,│
                 │   crypto-miner signatures            │
                 └──────────────────────────────────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │  HOST KERNEL (Linux) │
                  └──────────────────────┘
```

Each layer fails closed: a hole in one is contained by the next.

---

## E. Data Flow Summary

```
   write path                                read path
   ──────────                                ─────────
   client ─► API ─► Postgres (submission)    client ─► API ─► Redis (problem cache)
                 ─► S3 (code blob)                          ─► Postgres (history,
                 ─► Kafka submit.<lang>                          submission detail)
   worker ─► Postgres (verdict)              client ─► WebSocket ◄─ Result Service
          ─► Kafka verdict.events            client ─► CDN (static assets)
   Result ─► Redis (live status, leaderboard)
          ─► WebSocket push to client
```
