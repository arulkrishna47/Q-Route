import json
import networkx as nx
from app.optimization.objective import evaluate_assignment
from app.optimization.qpso import qpso_optimize
from app.optimization.baselines import run_dijkstra_baseline

def investigate():
    print("Loading data...")
    with open('data/demand.json') as f:
        demand = json.load(f)['demand']
    
    with open('data/candidate_routes.json') as f:
        routes = json.load(f)
        
    G = nx.read_graphml('data/network.graphml')
    edges = list(G.edges(keys=True, data=True))
    edge_data = {
        'edges': [(u, v, k) for u, v, k, d in edges],
        'capacities': [float(d.get('capacity', 800)) for u, v, k, d in edges],
        'free_flow_times': [float(d.get('free_flow_time', 100)) for u, v, k, d in edges],
        'lengths': [float(d.get('length', 100)) for u, v, k, d in edges],
    }
    
    # 1. Investigate Candidate Routes (FIX 2)
    # Check if any OD pair has > 1 route
    multi_route_pairs = sum(1 for r in routes if len(r['paths']) > 1)
    print(f"\n[FIX 2] OD pairs with multiple candidate routes: {multi_route_pairs} / {len(routes)}")
    
    if multi_route_pairs == 0:
        print("[FIX 2] Conclusion (a): No alternate routes exist! Max V/C identical because there's nowhere else to route.")
    else:
        print("[FIX 2] Alternate routes exist, why is Max V/C identical?")
        
    # 2. Investigate Weights (FIX 3)
    weights_default = {'time': 1.0, 'congestion': 1.0, 'co2': 1.0, 'penalty': 10.0}
    weights_time = {'time': 10.0, 'congestion': 0.1, 'co2': 0.1, 'penalty': 0.1}
    
    print("\n--- Running Baseline ---")
    base = run_dijkstra_baseline(G, routes, edge_data, weights_default, evaluate_assignment)
    print(f"Base - Total Time: {base['metrics']['total_travel_time']:.2f}")
    
    print("\n--- Running QPSO (Default Weights) ---")
    qpso_def = qpso_optimize(routes, edge_data, weights_default, evaluate_assignment, num_particles=10, max_iter=20)
    print(f"QPSO (Def) - Total Time: {qpso_def['metrics']['total_travel_time']:.2f}")
    
    print("\n--- Running QPSO (Max Time Weight) ---")
    qpso_time = qpso_optimize(routes, edge_data, weights_time, evaluate_assignment, num_particles=10, max_iter=20)
    print(f"QPSO (Time) - Total Time: {qpso_time['metrics']['total_travel_time']:.2f}")

if __name__ == "__main__":
    investigate()
