import networkx as nx
from itertools import islice

def k_shortest_paths(G, source, target, k=3, weight='free_flow_time'):
    """
    Returns the k-shortest paths from source to target using Yen's algorithm.
    networkx shortest_simple_paths implements Yen's algorithm but requires a simple Graph or DiGraph.
    """
    if isinstance(G, nx.MultiDiGraph):
        # Quick conversion for Yen's - we only need the node sequence
        # We can map it back to edges later
        G_simple = nx.DiGraph(G)
    else:
        G_simple = G
        
    def get_weight(u, v, d):
        try:
            return float(d.get(weight, 99999))
        except (ValueError, TypeError):
            return 99999.0
            
    try:
        paths = list(islice(nx.shortest_simple_paths(G_simple, source, target, weight=get_weight), k))
        return paths
    except nx.NetworkXNoPath:
        return []
    except Exception as e:
        print(f"Error finding paths {source}->{target}: {e}")
        return []

def generate_candidate_routes(G, demand_data, k=3, weight='free_flow_time'):
    """
    Generate k candidate routes for each OD pair in the demand data.
    """
    print(f"Generating up to {k} candidate routes for {len(demand_data)} OD pairs...")
    candidate_routes = []
    
    for i, od in enumerate(demand_data):
        o = od['origin']
        d = od['destination']
        vol = od['volume']
        
        paths = k_shortest_paths(G, o, d, k, weight)
        if not paths:
            # Fallback: maybe just the shortest path ignoring direction, or just drop
            print(f"No path found for OD pair {o} -> {d}. Dropping.")
            candidate_routes.append({
                'origin': o,
                'destination': d,
                'volume': vol,
                'paths': []
            })
            continue
            
        candidate_routes.append({
            'origin': o,
            'destination': d,
            'volume': vol,
            'paths': paths
        })
        
        if (i+1) % 10 == 0:
            print(f"Processed {i+1}/{len(demand_data)} pairs")
            
    return candidate_routes
