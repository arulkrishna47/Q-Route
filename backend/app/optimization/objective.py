import numpy as np

# BPR Function Parameters
ALPHA = 0.15
BETA = 4.0

def bpr_travel_time(free_flow_time, volume, capacity):
    """Calculate travel time using the BPR function."""
    if capacity == 0:
        return free_flow_time
    return free_flow_time * (1 + ALPHA * (volume / capacity)**BETA)

def calculate_edge_metrics(volumes, capacities, free_flow_times, lengths):
    """
    Vectorized calculation of metrics for all edges.
    volumes, capacities, free_flow_times, lengths are numpy arrays of size (num_edges,)
    """
    # Protect against division by zero
    caps = np.where(capacities == 0, 1, capacities)
    v_c_ratios = volumes / caps
    
    travel_times = free_flow_times * (1 + ALPHA * (v_c_ratios)**BETA)
    
    # Simple CO2 proxy: distance * congestion multiplier
    # Assuming baseline emission factor and it scales with V/C ratio
    co2_proxy = lengths * volumes * (1 + 0.5 * v_c_ratios) 
    
    # Capacity violations
    violations = np.maximum(0, volumes - caps)
    
    return travel_times, v_c_ratios, co2_proxy, violations

def evaluate_assignment(edge_volumes, capacities, free_flow_times, lengths, weights):
    """
    Evaluate a complete network assignment.
    weights = {'time': w1, 'congestion': w2, 'co2': w3, 'penalty': w4}
    Returns total normalized cost and detailed metrics.
    """
    tt, vc, co2, violations = calculate_edge_metrics(edge_volumes, capacities, free_flow_times, lengths)
    
    total_travel_time = np.sum(tt * edge_volumes) # System optimal objective: sum of (flow * travel_time)
    avg_vc = np.mean(vc)
    max_vc = np.max(vc)
    total_co2 = np.sum(co2)
    total_penalty = np.sum(violations**2) # Quadratic penalty
    
    # Normalization factors
    norm_tt = total_travel_time / 1000.0  # Scale down to readable numbers
    norm_congestion = avg_vc * 10.0
    norm_co2 = total_co2 / 1000.0
    norm_penalty = total_penalty / 10.0
    
    total_cost = (weights.get('time', 1.0) * norm_tt +
                  weights.get('congestion', 1.0) * norm_congestion +
                  weights.get('co2', 1.0) * norm_co2 +
                  weights.get('penalty', 10.0) * norm_penalty)
                  
    metrics = {
        'total_cost': float(total_cost),
        'total_travel_time': float(total_travel_time),
        'avg_vc': float(avg_vc),
        'max_vc': float(max_vc),
        'total_co2': float(total_co2),
        'total_penalty': float(total_penalty),
        'capacity_violations_count': int(np.sum(violations > 0)),
        'edge_volumes': edge_volumes.tolist()
    }
    return float(total_cost), metrics
