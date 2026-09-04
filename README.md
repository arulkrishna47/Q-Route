# Q-ROUTE 🚦⚛️
### Quantum-Inspired Urban Traffic Optimization System (System Optimum Routing)

[![React](https://img.shields.io/badge/Frontend-React%2019%20%7C%20TypeScript%20%7C%20Vite-blue)](https://vitejs.dev/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%7C%20Python%203.11-green)](https://fastapi.tiangolo.com/)
[![OpenStreetMap](https://img.shields.io/badge/Geospatial-OpenStreetMap%20%7C%20OSMnx-orange)](https://osmnx.readthedocs.io/)
[![Optimization](https://img.shields.io/badge/Optimization-Quantum--Behaved%20PSO%20(QPSO)-purple)](#quantum-behaved-particle-swarm-optimization-qpso)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)

---

## 📌 Master Documentation
> 📖 **Looking for the complete technical whitepaper, mathematical derivations, API schema, and deployment guide?**  
> See the [**Master System Documentation (`SYSTEM_DOCUMENTATION.md`)**](SYSTEM_DOCUMENTATION.md).

---

## 🌐 The Fundamental Problem: Selfish Navigation vs. System Optimum

Today's consumer navigation platforms (Google Maps, Apple Maps, Waze) optimize purely for the **individual driver**. Every commuter independently runs a shortest-path algorithm (Dijkstra or $A^*$), driving the road network into **Wardrop's First Principle: User Equilibrium (UE)**.

This produces three catastrophic urban failures:
1. **Bottleneck Gridlock:** Thousands of commuters are simultaneously dumped onto a single "fastest" arterial, creating cascading chokepoints.
2. **Braess's Paradox:** Adding a new road or routing everyone down a shortcut often *increases* the average travel time for the entire city.
3. **The Compliance Barrier:** Academic multi-commodity flow papers assume 100% voluntary driver cooperation—an assumption that completely fails in the real world.

---

## ⚡ What Q-ROUTE Delivers

**Q-ROUTE** shifts urban mobility to **Wardrop's Second Principle: System Optimum (SO)**, minimizing network-wide total travel time, tailpipe emissions, and bottleneck formation using **Quantum-Behaved Particle Swarm Optimization (QPSO)**.

Crucially, Q-ROUTE bridges the theory-practice divide through its **4-Tier Compliance Gradient**:
- 🚥 **Tier 1: Traffic Signal Retiming (100% Forced Compliance):** Dynamically increases green-phase durations along prioritized corridors via Webster's method. Requires zero driver software or cooperation.
- 🚌 **Tier 2: Municipal Fleet Dispatch (80 - 100% Compliance):** Directly routes city buses (BMTC/MTC), sanitation vehicles, and emergency responders onto non-interfering corridors.
- 📱 **Tier 3: GPS Navigation Partner Feeds (5 - 15% Voluntary Compliance):** Pushes targeted bypass advisories to navigation partners. Backed by empirical Google Research proving that shifting just 5-15% of vehicles prevents network-wide bottleneck collapse.
- 💳 **Tier 4: Dynamic Congestion Pricing:** Generates real-time FASTag toll rate recommendations based on link volume-to-capacity ($V/C$) ratios.

---

## 🏗️ System Architecture

```
+─────────────────────────────────────────────────────────────────────────────+
│                       DATA INGESTION & NETWORK MODELING                      │
│  [OpenStreetMap API] ──► [OSMnx Ingestion] ──► [Strongly Connected Comp.]   │
│                                                     │                       │
│  [Synthetic Gravity Model] ◄── [IRC Capacity] ◄── [NetworkX GraphML]        │
+──────────────────────────────────────┬──────────────────────────────────────+
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                           COMBINATORIAL ROUTING CORE                         │
│  [OD Demand Pairs] ──► [Yen's K-Shortest Paths (K=3)] ──► [Route Candidates]│
+──────────────────────────────────────┬──────────────────────────────────────+
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                           QPSO OPTIMIZATION ENGINE                          │
│  [20-Particle Swarm] ──► [Delta Potential Well] ──► [Mean Best Tracking]    │
│            ▲                                                    │           │
│            └────────────── [BPR Objective Function] ◄───────────┘           │
+──────────────────────────────────────┬──────────────────────────────────────+
                                       ▼
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
+──────────────────────────────────────+  +───────────────────────────────────+
│   PHYSICAL ACTION TRANSLATION        │  │     ANALYST & AUDIT BENCHMARKS    │
│  - Signal Retiming (Webster Method)  │  │  - 10-Seed Multi-Algorithm Test   │
│  - Municipal Fleet Dispatch API      │  │  - What-If Road Closure Mode      │
│  - GPS Partner Advisory Push         │  │  - Chronological Experiment Audit │
│  - Dynamic Pricing Toll Modulation   │  │  - OD Decision Explainability     │
+──────────────────┬───────────────────+  +─────────────────┬─────────────────+
                   └───────────────────┬────────────────────┘
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                   REACT 19 EXECUTIVE DASHBOARD FRONTEND                     │
│  - Operator Console & Frame-by-Frame Swarm Animation Player                 │
│  - Analyst Dual-Map Comparison (Dijkstra vs. Q-ROUTE)                       │
│  - Recharts Cost Convergence Curves & Impact Metric Banners                 │
+─────────────────────────────────────────────────────────────────────────────+
```

---

## 📊 Empirical Benchmarks (10-Seed Test on Koramangala Network)

| Metric | Dijkstra (Selfish) | Traffic-Aware Dijkstra | Genetic Algorithm (GA) | QPSO (Q-ROUTE) |
| :--- | :---: | :---: | :---: | :---: |
| **Optimization Philosophy** | User Equilibrium | Iterative Heuristic | Heuristic Search | **System Optimum** |
| **Mean Fitness Cost** | 1029.62 | 1020.48 | 1297.34 | **862.40 (-16.2%)** |
| **Cost Std. Dev. (10 Seeds)** | $\pm 0.0$ | $\pm 0.0$ | $\pm 43.12$ | **$\pm 18.24$ (Highly Stable)** |
| **Capacity Violations ($V/C > 1.0$)** | 2 Bottlenecks | 1 Bottleneck | 1 Bottleneck | **0 Bottlenecks (100% Cleared)** |
| **Max $V/C$ Congestion Ratio** | 1.28 (Severe gridlock) | 1.12 | 1.08 | **0.88 (Free-Flow Maintained)** |
| **Execution Runtime** | 0.015 s | 0.042 s | 3.205 s | **0.482 s (Sub-second)** |

---

## 🚀 Quickstart Guide

### 1. Clone & Backend Setup
```bash
git clone https://github.com/arulkumar2003/q-route.git
cd q-route/backend

# Create virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1  # On Linux/macOS: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run backend ASGI server
python -m uvicorn app.api.main:app --host 0.0.0.0 --port 8000 --reload
```
*API running at `http://localhost:8000` | Interactive docs at `http://localhost:8000/docs`.*

### 2. Frontend Setup
```bash
cd ../frontend
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```
*Frontend running at `http://localhost:3000`.*

### 3. (Alternative) Single-Command Docker Launch
```bash
docker-compose up --build
```

---

## 🧪 Key Features

- 🎛️ **Operator Console:** Real-time optimization with time-of-day heuristic suggestions (Standard, Peak Hour, Low Emission Day, Congestion Relief).
- ▶️ **Frame-by-Frame Swarm Animation:** Visualizes particles shifting traffic off congested corridors across all 30 optimization epochs.
- 🗺️ **Analyst Dual-Map Comparison:** Side-by-side synchronized view of User Equilibrium (Dijkstra) vs. System Optimum (Q-ROUTE).
- 🚧 **What-If Road Closure Mode:** Interactively click any road to close it and immediately simulate disaster recovery and detour routing.
- 📈 **Multi-Algorithm Benchmarks:** Run 10-seed automated evaluations against Dijkstra, TA-Dijkstra, and GA with box-whisker metrics.
- 💡 **Decision Explainability:** Inspect any origin-destination pair to get transparent civil engineering rationales for route diversions.
- 🏷️ **Data Provenance Standards:** Strict tags for `[OBSERVED]`, `[DERIVED]`, and `[SIMULATED]` data points.

---

## 📜 License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
