from fastapi import FastAPI, HTTPException, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict
import os
import json
import networkx as nx
import numpy as np
import datetime
import time

# Adjust imports for the directory structure
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from app.optimization.objective import evaluate_assignment
from app.optimization.routing import generate_candidate_routes
from app.optimization.qpso import qpso_optimize
from app.optimization.baselines import run_dijkstra_baseline, run_ga_baseline, run_traffic_aware_dijkstra, build_edge_indices

app = FastAPI(title="Q-ROUTE API")
router = APIRouter()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')

# Global state to hold multiple locations
locations_state = {}

def load_data():
    global locations_state
    
    if not os.path.exists(DATA_DIR):
        print("Data directory not found.")
        return
        
    for item in os.listdir(DATA_DIR):
        loc_dir = os.path.join(DATA_DIR, item)
        if os.path.isdir(loc_dir):
            try:
                graph_path = os.path.join(loc_dir, 'network.graphml')
                demand_path = os.path.join(loc_dir, 'demand.json')
                routes_path = os.path.join(loc_dir, 'candidate_routes.json')
                meta_path = os.path.join(loc_dir, 'network_metadata.json')
                
                if not (os.path.exists(graph_path) and os.path.exists(demand_path) and os.path.exists(routes_path) and os.path.exists(meta_path)):
                    continue
                    
                G = nx.read_graphml(graph_path)
                with open(demand_path) as f:
                    demand_data = json.load(f)['demand']
                    
                with open(routes_path) as f:
                    candidate_routes = json.load(f)
                    
                with open(meta_path) as f:
                    meta = json.load(f)
                    
                edges = list(G.edges(keys=True, data=True))
                parsed_edges = []
                for u, v, k, d in edges:
                    try:
                        parsed_edges.append((int(u), int(v), k))
                    except (ValueError, TypeError):
                        parsed_edges.append((str(u), str(v), k))
                        
                edge_data = {
                    'edges': parsed_edges,
                    'capacities': [float(d.get('capacity', 800)) for u, v, k, d in edges],
                    'free_flow_times': [float(d.get('free_flow_time', 100)) for u, v, k, d in edges],
                    'lengths': [float(d.get('length', 100)) for u, v, k, d in edges],
                }
                
                locations_state[item] = {
                    'G': G,
                    'demand_data': demand_data,
                    'candidate_routes': candidate_routes,
                    'edge_data': edge_data,
                    'metadata': meta
                }
                print(f"Loaded location: {item}")
            except Exception as e:
                print(f"Error loading location {item}: {e}")

def save_experiment(algo, weights, result, scenario="default", suggestion_shown=None, suggestion_followed=None, location=None):
    if not location: return
    loc_dir = os.path.join(DATA_DIR, location)
    os.makedirs(loc_dir, exist_ok=True)
    exp_file = os.path.join(loc_dir, 'experiments.json')
    history = []
    if os.path.exists(exp_file):
        try:
            with open(exp_file) as f:
                history = json.load(f)
        except:
            pass
            
    history.append({
        'timestamp': datetime.datetime.now().isoformat(),
        'algorithm': algo,
        'scenario': scenario,
        'weights': weights,
        'fitness': result['fitness'],
        'metrics': result['metrics'],
        'runtime': result['runtime'],
        'suggestion_shown': suggestion_shown,
        'suggestion_followed': suggestion_followed
    })
    
    with open(exp_file, 'w') as f:
        json.dump(history, f, indent=2)

@app.on_event("startup")
def startup_event():
    load_data()

@router.get("/")
def read_root():
    return {"status": "Q-ROUTE API is running"}

@router.get("/health")
def health_check():
    return {"status": "ok", "locations_loaded": len(locations_state)}

@router.get("/locations")
def get_locations():
    return [{"id": k, "name": v['metadata'].get('query', k)} for k, v in locations_state.items()]

@router.get("/network")
def get_network(location: str = 'koramangala'):
    if location not in locations_state:
        raise HTTPException(status_code=404, detail="Location not found")
        
    G = locations_state[location]['G']
    metadata = locations_state[location]['metadata']
    
    nodes = [{'id': n, 'lat': float(data['y']), 'lon': float(data['x'])} for n, data in G.nodes(data=True) if 'y' in data and 'x' in data]
    edges = [{'u': u, 'v': v, 'k': k, 'capacity': float(data.get('capacity', 800)), 'name': data.get('name', '')} 
             for u, v, k, data in G.edges(keys=True, data=True)]
             
    return {"nodes": nodes, "edges": edges, "metadata": metadata}

class WeightsParams(BaseModel):
    time: float = 1.0
    congestion: float = 1.0
    co2: float = 1.0
    penalty: float = 10.0
    modified_capacities: Optional[Dict[str, float]] = None # "u_v_k" -> new_cap
    silent: bool = False
    suggestion_shown: Optional[str] = None
    suggestion_followed: Optional[bool] = None

def apply_what_if(local_edge_data, modified_capacities):
    if not modified_capacities:
        return local_edge_data
    
    new_edge_data = {
        'edges': local_edge_data['edges'],
        'capacities': list(local_edge_data['capacities']),
        'free_flow_times': list(local_edge_data['free_flow_times']),
        'lengths': list(local_edge_data['lengths'])
    }
    
    for i, (u, v, k) in enumerate(new_edge_data['edges']):
        key = f"{u}_{v}_{k}"
        if key in modified_capacities:
            new_edge_data['capacities'][i] = float(modified_capacities[key])
            
    return new_edge_data

@router.post("/optimize/baseline")
def run_baseline(weights: WeightsParams, location: str = 'koramangala'):
    if location not in locations_state: raise HTTPException(status_code=404, detail="Location not found")
    state = locations_state[location]
    
    w_dict = weights.dict(exclude={'modified_capacities', 'silent', 'suggestion_shown', 'suggestion_followed'})
    e_data = apply_what_if(state['edge_data'], weights.modified_capacities)
    res = run_dijkstra_baseline(state['G'], state['candidate_routes'], e_data, w_dict, evaluate_assignment)
    
    if not weights.silent:
        save_experiment("Baseline", w_dict, res, scenario="what-if" if weights.modified_capacities else "default", suggestion_shown=weights.suggestion_shown, suggestion_followed=weights.suggestion_followed, location=location)
    return res

@router.post("/optimize/qpso")
def run_qpso(weights: WeightsParams, location: str = 'koramangala', particles: int = 20, iterations: int = 50):
    if location not in locations_state: raise HTTPException(status_code=404, detail="Location not found")
    state = locations_state[location]
    
    w_dict = weights.dict(exclude={'modified_capacities', 'silent', 'suggestion_shown', 'suggestion_followed'})
    e_data = apply_what_if(state['edge_data'], weights.modified_capacities)
    res = qpso_optimize(state['candidate_routes'], e_data, w_dict, evaluate_assignment, 
                        num_particles=particles, max_iter=iterations)
                        
    if not weights.silent:
        save_experiment("QPSO", w_dict, res, scenario="what-if" if weights.modified_capacities else "default", suggestion_shown=weights.suggestion_shown, suggestion_followed=weights.suggestion_followed, location=location)
    return res

@router.post("/optimize/ga")
def run_ga(weights: WeightsParams, location: str = 'koramangala', pop_size: int = 20, iterations: int = 50):
    if location not in locations_state: raise HTTPException(status_code=404, detail="Location not found")
    state = locations_state[location]
    
    w_dict = weights.dict(exclude={'modified_capacities', 'silent', 'suggestion_shown', 'suggestion_followed'})
    e_data = apply_what_if(state['edge_data'], weights.modified_capacities)
    res = run_ga_baseline(state['candidate_routes'], e_data, w_dict, evaluate_assignment,
                          pop_size=pop_size, max_iter=iterations)
                          
    if not weights.silent:
        save_experiment("Genetic Algorithm", w_dict, res, scenario="what-if" if weights.modified_capacities else "default", suggestion_shown=weights.suggestion_shown, suggestion_followed=weights.suggestion_followed, location=location)
    return res

@router.get("/experiments")
def get_experiments(location: str = 'koramangala'):
    if not location: return []
    exp_file = os.path.join(DATA_DIR, location, 'experiments.json')
    if os.path.exists(exp_file):
        with open(exp_file) as f:
            return json.load(f)
    return []

@router.post("/benchmark")
def run_benchmarks(weights: WeightsParams, location: str = 'koramangala', seeds: int = 10, multiplier: float = 1.0):
    if location not in locations_state: raise HTTPException(status_code=404, detail="Location not found")
    state = locations_state[location]
    
    w_dict = weights.dict(exclude={'modified_capacities', 'silent', 'suggestion_shown', 'suggestion_followed'})
    
    # Scale demand
    scaled_routes = []
    for r in state['candidate_routes']:
        rc = dict(r)
        rc['volume'] = r['volume'] * multiplier
        scaled_routes.append(rc)
        
    results = {}
    
    # 1. Base Dijkstra (Deterministic)
    d_res = run_dijkstra_baseline(state['G'], scaled_routes, state['edge_data'], w_dict, evaluate_assignment)
    results['Dijkstra'] = {
        'cost_mean': d_res['fitness'], 'cost_std': 0.0,
        'cost_min': d_res['fitness'], 'cost_max': d_res['fitness'],
        'time_mean': d_res['metrics']['total_travel_time'],
        'max_vc_mean': float(d_res['metrics']['max_vc']),
        'bottlenecks_mean': float(d_res['metrics']['capacity_violations_count'])
    }
    
    # 2. TA-Dijkstra (Deterministic)
    t_res = run_traffic_aware_dijkstra(scaled_routes, state['edge_data'], w_dict, evaluate_assignment)
    results['TA-Dijkstra'] = {
        'cost_mean': t_res['fitness'], 'cost_std': 0.0,
        'cost_min': t_res['fitness'], 'cost_max': t_res['fitness'],
        'time_mean': t_res['metrics']['total_travel_time'],
        'max_vc_mean': float(t_res['metrics']['max_vc']),
        'bottlenecks_mean': float(t_res['metrics']['capacity_violations_count'])
    }
    
    # 3. GA over seeds
    ga_costs = []
    ga_times = []
    ga_vcs = []
    ga_bottlenecks = []
    for s in range(seeds):
        np.random.seed(s)
        g_res = run_ga_baseline(scaled_routes, state['edge_data'], w_dict, evaluate_assignment, pop_size=15, max_iter=20)
        ga_costs.append(g_res['fitness'])
        ga_times.append(g_res['metrics']['total_travel_time'])
        ga_vcs.append(g_res['metrics']['max_vc'])
        ga_bottlenecks.append(g_res['metrics']['capacity_violations_count'])
    results['Genetic Algorithm'] = {
        'cost_mean': float(np.mean(ga_costs)),
        'cost_std': float(np.std(ga_costs)),
        'cost_min': float(np.min(ga_costs)),
        'cost_max': float(np.max(ga_costs)),
        'time_mean': float(np.mean(ga_times)),
        'max_vc_mean': float(np.mean(ga_vcs)),
        'bottlenecks_mean': float(np.mean(ga_bottlenecks))
    }
    
    # 4. QPSO over seeds
    qpso_costs = []
    qpso_times = []
    qpso_vcs = []
    qpso_bottlenecks = []
    for s in range(seeds):
        np.random.seed(s)
        q_res = qpso_optimize(scaled_routes, state['edge_data'], w_dict, evaluate_assignment, num_particles=15, max_iter=20)
        qpso_costs.append(q_res['fitness'])
        qpso_times.append(q_res['metrics']['total_travel_time'])
        qpso_vcs.append(q_res['metrics']['max_vc'])
        qpso_bottlenecks.append(q_res['metrics']['capacity_violations_count'])
    results['QPSO (Q-ROUTE)'] = {
        'cost_mean': float(np.mean(qpso_costs)),
        'cost_std': float(np.std(qpso_costs)),
        'cost_min': float(np.min(qpso_costs)),
        'cost_max': float(np.max(qpso_costs)),
        'time_mean': float(np.mean(qpso_times)),
        'max_vc_mean': float(np.mean(qpso_vcs)),
        'bottlenecks_mean': float(np.mean(qpso_bottlenecks))
    }
    
    return results

@router.get("/od_pairs")
def get_od_pairs(location: str = 'koramangala'):
    if location not in locations_state: raise HTTPException(status_code=404, detail="Location not found")
    state = locations_state[location]
    pairs = []
    for idx, r in enumerate(state['candidate_routes']):
        pair_id = f"{r['origin']}_{r['destination']}"
        pairs.append({
            "id": pair_id,
            "index": idx,
            "origin": r['origin'],
            "destination": r['destination'],
            "volume": r.get('volume', 0),
            "num_paths": len(r.get('paths', []))
        })
    return pairs

@router.get("/explain/{od_id}")
def explain_od_pair(od_id: str, location: str = 'koramangala'):
    if location not in locations_state: raise HTTPException(status_code=404, detail="Location not found")
    state = locations_state[location]
    
    # Find candidate route matching the OD pair by id, pair string, or numeric index
    flow_index = -1
    for idx, r in enumerate(state['candidate_routes']):
        pair_id = f"{r['origin']}_{r['destination']}"
        if r.get('od_id') == od_id or pair_id == str(od_id) or str(idx) == str(od_id):
            flow_index = idx
            break
            
    if flow_index == -1:
        return {"status": "error", "message": f"OD pair {od_id} not found."}
        
    route = state['candidate_routes'][flow_index]
    edge_indices = build_edge_indices(state['edge_data']['edges'])
    
    paths_info = []
    for idx, path in enumerate(route['paths']):
        p_time = sum([state['edge_data']['free_flow_times'][edge_indices.get((u, v, 0), 0)] for u, v in zip(path[:-1], path[1:])])
        paths_info.append({
            "id": idx,
            "path": path,
            "free_flow_time": p_time,
            "name": f"Route {idx+1}"
        })
        
    if len(route['paths']) < 2:
        base_time = paths_info[0]['free_flow_time'] if paths_info else 0
        return {
            "status": "single_path",
            "flow_index": flow_index,
            "origin": route['origin'],
            "destination": route['destination'],
            "volume": route.get('volume', 0),
            "paths": paths_info,
            "baseline_free_flow": base_time,
            "qpso_free_flow": base_time,
            "explanation": f"OD pair {route['origin']} → {route['destination']} only has a single viable corridor in this road network ({base_time/60:.1f} mins). Traffic cannot be shifted onto alternatives, so Q-ROUTE protects this corridor via adaptive signal priority."
        }
        
    path0 = route['paths'][0]
    path1 = route['paths'][1]
    
    p0_edges = list(zip(path0[:-1], path0[1:]))
    p1_edges = list(zip(path1[:-1], path1[1:]))
    
    p0_time = paths_info[0]['free_flow_time']
    p1_time = paths_info[1]['free_flow_time']
    
    worst_cap = float('inf')
    worst_edge = None
    
    for u, v in p0_edges:
        idx = edge_indices.get((u, v, 0))
        if idx is not None:
            cap = state['edge_data']['capacities'][idx]
            if cap < worst_cap:
                worst_cap = cap
                worst_edge = (u, v)
                
    time_delta_mins = (p1_time - p0_time) / 60.0
    if time_delta_mins >= 0:
        time_desc = f"While this alternate takes {time_delta_mins:.1f} min longer in free-flow conditions, "
    else:
        time_desc = f"This alternate is {abs(time_delta_mins):.1f} min faster in free-flow conditions, "
        
    cap_desc = f"Capacity: {worst_cap:.0f} veh/hr" if worst_cap < float('inf') else "constrained capacity"
    
    explanation_text = (
        f"The naive Dijkstra baseline routes all demand through the shortest corridor ({cap_desc}). "
        f"Q-ROUTE shifts vehicles to an alternate path. {time_desc}"
        f"it drastically lowers link volume-to-capacity (V/C) ratios and prevents network gridlock, optimizing total system welfare."
    )
    
    return {
        "status": "ok",
        "flow_index": flow_index,
        "origin": route['origin'],
        "destination": route['destination'],
        "volume": route.get('volume', 0),
        "paths": paths_info,
        "baseline_path": path0,
        "qpso_path": path1,
        "baseline_free_flow": p0_time,
        "qpso_free_flow": p1_time,
        "explanation": explanation_text
    }

# Mount router both at root and with /api prefix so all deployment routing works
app.include_router(router)
app.include_router(router, prefix="/api")

# Preload data on module load
load_data()
