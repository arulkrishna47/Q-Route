import json
import networkx as nx
from app.optimization.objective import evaluate_assignment
from app.optimization.qpso import qpso_optimize
from app.optimization.baselines import run_dijkstra_baseline

def verify():
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
    
    # Run Baseline
    base = run_dijkstra_baseline(G, routes, edge_data, {'time': 1, 'congestion': 1, 'co2': 1, 'penalty': 10}, evaluate_assignment)
    
    print("\n[FIX 2] Baseline Max V/C:", base['metrics']['max_vc'])
    # Find the edge with Max V/C in baseline
    max_vc = base['metrics']['max_vc']
    max_vc_edge_idx = None
    for i, vol in enumerate(base['edge_volumes']):
        cap = edge_data['capacities'][i] if edge_data['capacities'][i] > 0 else 1
        if abs((vol / cap) - max_vc) < 1e-4:
            max_vc_edge_idx = i
            break
            
    print(f"Max V/C Edge Index: {max_vc_edge_idx}")
    if max_vc_edge_idx is not None:
        u, v, k = edge_data['edges'][max_vc_edge_idx]
        print(f"Max V/C Edge: ({u}, {v})")
        
        # Check how many candidate routes use this edge
        routes_using_edge = 0
        total_routes_across_bottleneck = 0
        for r in routes:
            uses_edge = False
            for path in r['paths']:
                edges_in_path = list(zip(path[:-1], path[1:]))
                if (u, v) in edges_in_path:
                    uses_edge = True
                    break
            if uses_edge:
                total_routes_across_bottleneck += 1
                # Does every SINGLE path in this OD pair use the edge?
                unavoidable = True
                for path in r['paths']:
                    edges_in_path = list(zip(path[:-1], path[1:]))
                    if (u, v) not in edges_in_path:
                        unavoidable = False
                        break
                if unavoidable:
                    routes_using_edge += 1
                    
        print(f"OD pairs that cross this bottleneck: {total_routes_across_bottleneck}")
        print(f"OD pairs where this bottleneck is UNAVOIDABLE (all paths use it): {routes_using_edge}")

    # FIX 3: Objective Weights
    print("\n--- [FIX 3] Weight Wiring ---")
    qpso_time = qpso_optimize(routes, edge_data, {'time': 10, 'congestion': 0.1, 'co2': 0, 'penalty': 0}, evaluate_assignment, num_particles=10, max_iter=20)
    print(f"QPSO (Time Max) - TT: {qpso_time['metrics']['total_travel_time']:.2f}, Max VC: {qpso_time['metrics']['max_vc']:.2f}")

    qpso_cong = qpso_optimize(routes, edge_data, {'time': 0, 'congestion': 10, 'co2': 0, 'penalty': 10}, evaluate_assignment, num_particles=10, max_iter=20)
    print(f"QPSO (Congestion Max) - TT: {qpso_cong['metrics']['total_travel_time']:.2f}, Max VC: {qpso_cong['metrics']['max_vc']:.2f}")

    # BUILD 1: Benchmarks
    print("\n--- [BUILD 1] Benchmarks ---")
    from app.api.main import run_benchmarks
    class Weights:
        def dict(self, **kwargs): return {'time': 1, 'congestion': 1, 'co2': 1, 'penalty': 10}
        @property
        def modified_capacities(self): return None
        
    print("Demand x1.0:")
    res1 = run_benchmarks(Weights(), seeds=5, multiplier=1.0)
    for algo, res in res1.items():
        print(f"  {algo}: {res['cost_mean']:.2f}")
        
    print("Demand x2.0:")
    res2 = run_benchmarks(Weights(), seeds=5, multiplier=2.0)
    for algo, res in res2.items():
        print(f"  {algo}: {res['cost_mean']:.2f}")

if __name__ == "__main__":
    verify()
