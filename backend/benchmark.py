import json
import os
import networkx as nx
import numpy as np
import time
from app.optimization.objective import evaluate_assignment
from app.optimization.qpso import qpso_optimize
from app.optimization.baselines import run_dijkstra_baseline

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

def run_benchmark():
    # Load data
    with open(os.path.join(DATA_DIR, 'demand.json')) as f:
        demand_data = json.load(f)['demand']
    
    with open(os.path.join(DATA_DIR, 'candidate_routes.json')) as f:
        candidate_routes = json.load(f)
        
    G = nx.read_graphml(os.path.join(DATA_DIR, 'network.graphml'))
    edges = list(G.edges(keys=True, data=True))
    edge_data = {
        'edges': [(u, v, k) for u, v, k, d in edges],
        'capacities': [float(d.get('capacity', 800)) for u, v, k, d in edges],
        'free_flow_times': [float(d.get('free_flow_time', 100)) for u, v, k, d in edges],
        'lengths': [float(d.get('length', 100)) for u, v, k, d in edges],
    }
    
    weights = {'time': 1.0, 'congestion': 1.0, 'co2': 1.0, 'penalty': 10.0}
    
    # 1. Run Dijkstra Baseline (Deterministic)
    dijkstra_res = run_dijkstra_baseline(G, candidate_routes, edge_data, weights, evaluate_assignment)
    base_cost = dijkstra_res['fitness']
    
    # 2. Run QPSO across 10 seeds
    seeds = range(10)
    costs = []
    
    print("Running QPSO across 10 seeds...")
    for seed in seeds:
        np.random.seed(seed)
        res = qpso_optimize(candidate_routes, edge_data, weights, evaluate_assignment, num_particles=20, max_iter=30)
        costs.append(res['fitness'])
        
    costs = np.array(costs)
    
    print("\n--- BENCHMARK RESULTS ---")
    print(f"Demand scale: {sum(d['volume'] for d in demand_data)} vehicles")
    print(f"Dijkstra Baseline Cost: {base_cost:.2f}")
    print(f"QPSO Cost - Mean: {np.mean(costs):.2f}, Std: {np.std(costs):.2f}")
    print(f"QPSO Cost - Best: {np.min(costs):.2f}, Worst: {np.max(costs):.2f}")
    
    if np.mean(costs) < base_cost:
        print(f"Result: QPSO WON on average by {(base_cost - np.mean(costs))/base_cost*100:.2f}%")
    else:
        print(f"Result: QPSO LOST on average by {(np.mean(costs) - base_cost)/base_cost*100:.2f}%")
        print("Note: In scenarios with low congestion or purely grid networks, routing everyone on the shortest path (Dijkstra) creates no bottlenecks, meaning QPSO's overhead is unnecessary and it may occasionally fall into local optima worse than Dijkstra.")

if __name__ == "__main__":
    run_benchmark()
