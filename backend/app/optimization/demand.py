import networkx as nx
import osmnx as ox
import numpy as np
import json
import os
from collections import defaultdict
import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')

def fetch_poi_density_and_generate_demand(G, data_dir, bbox, num_pairs=100, total_vehicles=5000):
    """
    Generate synthetic OD demand using a gravity model based on real OSM POIs.
    """
    print("Fetching POIs (amenity and building tags) for gravity model...")
    # Get geometries for amenities and buildings within bbox
    tags = {'amenity': True, 'building': ['commercial', 'retail', 'office', 'apartments']}
    try:
        pois = ox.features_from_bbox(bbox=bbox, tags=tags)
        print(f"Fetched {len(pois)} POI features.")
    except Exception as e:
        print(f"Error fetching POIs: {e}")
        pois = None
    
    # Assign weight to nodes based on POIs
    node_weights = defaultdict(float)
    nodes_gdf, _ = ox.graph_to_gdfs(G)
    
    # Default weight if POI match fails
    for node in G.nodes:
        node_weights[node] = 1.0
        
    if pois is not None and not pois.empty:
        # Reproject to local UTM to calculate distances easily if needed, but we can just use spatial index
        pois_geom = pois.geometry.centroid
        
        # Simple proximity check: for each POI, add weight to nearest network node
        # In a real heavy system we'd use sindex, but for a small bbox ox.nearest_nodes is ok
        poi_xs = pois_geom.x.values
        poi_ys = pois_geom.y.values
        
        # Batch find nearest nodes
        try:
            nearest_nodes = ox.nearest_nodes(G, X=poi_xs, Y=poi_ys)
            for node in nearest_nodes:
                node_weights[node] += 10.0 # Each POI adds weight
        except Exception as e:
            print(f"Error matching POIs to nodes: {e}")

    # Generate gravity model probabilities
    nodes = list(G.nodes())
    n = len(nodes)
    weights = np.array([node_weights[node] for node in nodes])
    
    # We want to select O and D pairs. 
    # Gravity model: P(i, j) = W_i * W_j / d(i, j)^2
    print("Computing distance matrix for gravity model (sampled)...")
    
    # Since all-pairs shortest path is O(V^3), we'll sample O and D
    sampled_indices = np.random.choice(n, size=min(n, 400), replace=False)
    sampled_nodes = [nodes[i] for i in sampled_indices]
    
    od_pairs = []
    
    for i in range(len(sampled_nodes)):
        for j in range(i+1, len(sampled_nodes)):
            u = sampled_nodes[i]
            v = sampled_nodes[j]
            try:
                # Euclidean distance proxy for gravity model (to avoid full graph SP computation)
                dx = nodes_gdf.loc[u].geometry.x - nodes_gdf.loc[v].geometry.x
                dy = nodes_gdf.loc[u].geometry.y - nodes_gdf.loc[v].geometry.y
                dist_sq = dx**2 + dy**2
                if dist_sq > 0:
                    score = (node_weights[u] * node_weights[v]) / dist_sq
                    od_pairs.append({'O': u, 'D': v, 'score': score})
            except Exception:
                pass
                
    # Sort by score and pick top or sample based on score
    od_pairs.sort(key=lambda x: x['score'], reverse=True)
    selected_pairs = od_pairs[:num_pairs]
    
    # Distribute total_vehicles proportionally to score among selected pairs
    total_score = sum(p['score'] for p in selected_pairs)
    
    final_demand = []
    for p in selected_pairs:
        vehicles = max(1, int(total_vehicles * (p['score'] / total_score)))
        final_demand.append({'origin': int(p['O']), 'destination': int(p['D']), 'volume': vehicles})
        
    # Save to file
    demand_data = {
        "metadata": {
            "methodology": "Derived demand model (gravity-model, OSM POI density) — not observed trip data.",
            "total_vehicles": sum(d['volume'] for d in final_demand),
            "num_od_pairs": len(final_demand),
            "generated_at": datetime.datetime.utcnow().isoformat() + "Z"
        },
        "demand": final_demand
    }
    
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, 'demand.json'), 'w') as f:
        json.dump(demand_data, f, indent=2)
        
    print(f"Generated demand for {len(final_demand)} OD pairs.")
    return final_demand
