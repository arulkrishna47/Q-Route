import osmnx as ox
import networkx as nx
import json
import datetime
import os
import time

# (Removed hardcoded STUDY_AREA and DATA_DIR)

# Documented capacity estimates (vehicles per hour per lane)
CAPACITY_PER_LANE = {
    'motorway': 2000,
    'trunk': 2000,
    'primary': 1800,
    'secondary': 1500,
    'tertiary': 1200,
    'residential': 800,
    'unclassified': 800,
    'default': 800
}

# Documented speed limits (km/h) if missing
DEFAULT_SPEEDS = {
    'motorway': 80,
    'trunk': 80,
    'primary': 60,
    'secondary': 50,
    'tertiary': 40,
    'residential': 30,
    'unclassified': 30,
    'default': 30
}

def parse_lanes(lanes_tag):
    if isinstance(lanes_tag, list):
        lanes_tag = lanes_tag[0]
    try:
        return max(1, int(lanes_tag))
    except (ValueError, TypeError):
        return 1

def parse_speed(speed_tag):
    if isinstance(speed_tag, list):
        speed_tag = speed_tag[0]
    if isinstance(speed_tag, str):
        try:
            return float(''.join(c for c in speed_tag if c.isdigit() or c == '.'))
        except ValueError:
            pass
    try:
        return float(speed_tag)
    except (ValueError, TypeError):
        return None

def fetch_and_process_network(bbox):
    print(f"Fetching network for bbox {bbox}...")
    start_time = time.time()
    G = ox.graph_from_bbox(bbox=bbox, network_type="drive", simplify=True)
    
    # Process edges
    for u, v, key, data in G.edges(keys=True, data=True):
        hw_class = data.get('highway', 'default')
        if isinstance(hw_class, list):
            hw_class = hw_class[0]
            
        # Capacity
        lanes = parse_lanes(data.get('lanes', 1))
        per_lane = CAPACITY_PER_LANE.get(hw_class, CAPACITY_PER_LANE['default'])
        data['capacity'] = lanes * per_lane
        data['capacity_source'] = "estimated"
        
        # Speed
        speed = parse_speed(data.get('maxspeed'))
        if speed:
            data['speed_kph'] = speed
            data['speed_source'] = "tag"
        else:
            data['speed_kph'] = DEFAULT_SPEEDS.get(hw_class, DEFAULT_SPEEDS['default'])
            data['speed_source'] = "default"
            
        # Free flow travel time (seconds)
        length_m = data.get('length', 100) # ox adds length in meters
        speed_mps = data['speed_kph'] * (1000 / 3600)
        data['free_flow_time'] = length_m / speed_mps if speed_mps > 0 else 99999
        
    print(f"Fetched in {time.time() - start_time:.2f} seconds.")
    print(f"Nodes: {len(G.nodes)}, Edges: {len(G.edges)}")
    
    return G

def save_network(G, data_dir, place_name):
    os.makedirs(data_dir, exist_ok=True)
    graph_path = os.path.join(data_dir, 'network.graphml')
    ox.save_graphml(G, filepath=graph_path)
    
    metadata = {
        "source": "OpenStreetMap",
        "query": place_name,
        "fetch_timestamp_utc": datetime.datetime.utcnow().isoformat() + "Z",
        "nodes_count": len(G.nodes),
        "edges_count": len(G.edges),
        "attribution": "© OpenStreetMap contributors",
        "capacity_methodology": "Derived from lane counts and highway classification planning estimates.",
        "speed_methodology": "OSM maxspeed tag where present, default by class otherwise."
    }
    
    metadata_path = os.path.join(data_dir, 'network_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    print(f"Saved graph and metadata to {data_dir}")
